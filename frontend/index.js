


// Global State
let mediaRecorder = null;
let recordingChunks = [];
let recordedBlob = null;
let currentLanguage = null;
let currentScenario = null;
let isSpeaking = false;
let currentAudio = null;
let selectedLanguage = null;
let selectedScenario = null;

// AudioContext for reliable, autoplay-policy-safe playback
let audioCtx = null;
let currentAudioSource = null;

function ensureAudioContextRunning() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

// DOM Elements
const welcomeState = document.getElementById("welcomeState");
const sessionState = document.getElementById("sessionState");
const languageSelect = document.getElementById("languageSelect");
const scenarioSelect = document.getElementById("scenarioSelect");
const beginSessionBtn = document.getElementById("beginSessionBtn");
const scenarioSection = document.getElementById("scenarioSection");
const langCards = document.querySelectorAll(".lang-card");
const scenarioOptions = document.querySelectorAll(".scenario-option");
const languageBadge = document.getElementById("languageBadge");
const scenarioBadge = document.getElementById("scenarioBadge");
const exchangeNum = document.getElementById("exchangeNum");
const speakingBubble = document.getElementById("speakingBubble");
const startSessionBtn = document.getElementById("startSessionBtn");
const recordBtn = document.getElementById("recordBtn");
const micIcon = document.getElementById("micIcon");
const stopIcon = document.getElementById("stopIcon");
const recordingStatus = document.getElementById("recordingStatus");
const submitBtn = document.getElementById("submitBtn");
const endSessionBtn = document.getElementById("endSessionBtn");
const feedbackSection = document.getElementById("feedbackSection");
const getFeedbackArea = document.getElementById("getFeedbackArea");
const getFeedbackBtn = document.getElementById("getFeedbackBtn");
const feedbackContent = document.getElementById("feedbackContent");
const feedbackLanguage = document.getElementById("feedbackLanguage");
const feedbackScenario = document.getElementById("feedbackScenario");
const fluencyCircle = document.getElementById("fluencyCircle");
const fluencyValue = document.getElementById("fluencyValue");
const grammarCircle = document.getElementById("grammarCircle");
const grammarValue = document.getElementById("grammarValue");
const vocabularyText = document.getElementById("vocabularyText");
const mistakesTable = document.getElementById("mistakesTable");
const noMistakesText = document.getElementById("noMistakesText");
const newWordsArea = document.getElementById("newWordsArea");
const conversationTipText = document.getElementById("conversationTipText");
const newSessionBtn = document.getElementById("newSessionBtn");


// ========== UI STATE FUNCTIONS ==========

function showSessionPanel(language, scenario) {
    currentLanguage = language;
    currentScenario = scenario;

    welcomeState.classList.add("hidden");
    sessionState.classList.remove("hidden");
    feedbackSection.classList.add("hidden");

    languageBadge.textContent = language;
    scenarioBadge.textContent = scenario;
    exchangeNum.textContent = "1";

    speakingBubble.classList.add("hidden");
    startSessionBtn.classList.remove("hidden");
    recordBtn.classList.add("hidden");
    recordBtn.disabled = true;
    submitBtn.disabled = true;
    endSessionBtn.disabled = true;
    recordingStatus.textContent = "Click Start Conversation to begin";
}

function updateExchangeNumber(number) {
    exchangeNum.textContent = number;
}

function showSpeakingBubble() {
    speakingBubble.classList.remove("hidden");
}

function hideSpeakingBubble() {
    speakingBubble.classList.add("hidden");
}

function setCoachSpeaking(active, statusText = "Nancy is speaking...") {
    isSpeaking = active;
    if (active) {
        showSpeakingBubble();
        recordBtn.disabled = true;
        submitBtn.disabled = true;
        recordingStatus.textContent = statusText;
    } else {
        hideSpeakingBubble();
    }
}

function enableRecording() {
    recordBtn.disabled = false;
    endSessionBtn.disabled = false;
    recordingStatus.textContent = "Click to record";
}

function disableRecording() {
    recordBtn.disabled = true;
    submitBtn.disabled = true;
    submitBtn.classList.add("hidden");
}

function showFeedbackSection() {
    feedbackSection.classList.remove("hidden");
    getFeedbackArea.classList.remove("hidden");
    feedbackContent.classList.add("hidden");
    endSessionBtn.disabled = true;
    disableRecording();
    recordingStatus.textContent = "Conversation ended";
    hideSpeakingBubble();
}

function displayFeedback(data) {
    feedbackLanguage.textContent = data.language || currentLanguage;
    feedbackScenario.textContent = data.scenario || currentScenario;

    fluencyValue.textContent = data.fluency_score || 0;
    const fluencyOffset = 251.2 - ((data.fluency_score || 0) / 10) * 251.2;
    fluencyCircle.style.strokeDashoffset = fluencyOffset;

    grammarValue.textContent = data.grammar_accuracy || 0;
    const grammarOffset = 251.2 - ((data.grammar_accuracy || 0) / 10) * 251.2;
    grammarCircle.style.strokeDashoffset = grammarOffset;

    vocabularyText.textContent = data.vocabulary_range || "Not assessed";

    // Grammar Mistakes Table
    mistakesTable.innerHTML = "";
    if (data.grammar_mistakes && data.grammar_mistakes.length > 0) {
        noMistakesText.classList.add("hidden");
        data.grammar_mistakes.forEach((mistake) => {
            const row = document.createElement("tr");
            row.className = "border-b border-gray-100";
            row.innerHTML = `
                <td class="py-3 pr-4 text-red-500">${mistake.said}</td>
                <td class="py-3 pr-4 text-green-600">${mistake.correct}</td>
                <td class="py-3 text-gray-500">${mistake.rule}</td>
            `;
            mistakesTable.appendChild(row);
        });
    } else {
        noMistakesText.classList.remove("hidden");
    }

    // New Words to Learn
    newWordsArea.innerHTML = "";
    if (data.new_words_to_learn && data.new_words_to_learn.length > 0) {
        data.new_words_to_learn.forEach((word) => {
            const tag = document.createElement("span");
            tag.className = "bg-white text-gray-800 px-4 py-2 rounded-lg text-sm font-medium border border-pink-200 shadow-sm";
            tag.textContent = word;
            newWordsArea.appendChild(tag);
        });
    }

    conversationTipText.textContent = data.conversation_tip || "No tips available";

    getFeedbackArea.classList.add("hidden");
    feedbackContent.classList.remove("hidden");
}

function resetToWelcome() {
    currentLanguage = null;
    currentScenario = null;
    selectedLanguage = null;
    selectedScenario = null;
    isSpeaking = false;
    mediaRecorder = null;
    recordingChunks = [];
    recordedBlob = null;

    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    // Reset card selections
    langCards.forEach((c) => c.classList.remove("selected"));
    scenarioOptions.forEach((c) => c.classList.remove("selected"));
    scenarioSection.classList.add("hidden");
    beginSessionBtn.disabled = true;

    welcomeState.classList.remove("hidden");
    sessionState.classList.add("hidden");

    recordBtn.classList.remove("bg-red-500", "text-white", "recording-active");
    recordBtn.classList.add("bg-gray-100", "text-gray-400");
    micIcon.classList.remove("hidden");
    stopIcon.classList.add("hidden");
    submitBtn.classList.add("hidden");

    speakingBubble.classList.add("hidden");

    fluencyCircle.style.strokeDashoffset = 251.2;
    grammarCircle.style.strokeDashoffset = 251.2;
    getFeedbackBtn.textContent = "Get Feedback";
    getFeedbackBtn.disabled = false;
}


// ========== AUDIO FUNCTIONS ==========

async function handleAudioStream(response, onComplete) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const allChunks = [];
    let pendingLine = "";

    // Show speaking bubble immediately for each AI turn
    setCoachSpeaking(true, "Nancy is speaking...");

    // Stop any existing audio
    if (currentAudio) {
        try { currentAudio.pause(); currentAudio.src = ""; } catch(e) {}
        currentAudio = null;
    }

    let turnFinalized = false;
    let playbackWatchdog = null;
    const finishAudio = (audioUrl) => {
        if (turnFinalized) return;
        turnFinalized = true;
        if (playbackWatchdog) {
            clearInterval(playbackWatchdog);
            playbackWatchdog = null;
        }
        setCoachSpeaking(false);
        enableRecording();
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        if (onComplete) onComplete();
    };

    try {
        // Step 1: Collect all base64 lines from stream
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = pendingLine + decoder.decode(value, { stream: true });
            const lines = text.split("\n");
            pendingLine = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const binary = atob(trimmed);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    allChunks.push(bytes);
                } catch (e) { /* skip malformed line */ }
            }
        }
        const finalLine = pendingLine.trim();
        if (finalLine) {
            try {
                const binary = atob(finalLine);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                allChunks.push(bytes);
            } catch (e) {
                console.warn("[Audio] Ignored trailing malformed base64 chunk");
            }
        }

        console.log(`[Audio] Received ${allChunks.length} chunks`);
        if (allChunks.length === 0) {
            console.warn("[Audio] No chunks — nothing to play");
            finishAudio(null);
            return;
        }

        // Step 2: Combine into single buffer
        const totalLen = allChunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(totalLen);
        let off = 0;
        for (const chunk of allChunks) { combined.set(chunk, off); off += chunk.length; }
        console.log(`[Audio] Total size: ${totalLen} bytes`);

        // Step 3: Create Blob URL
        const blob = new Blob([combined], { type: "audio/mpeg" });
        const audioUrl = URL.createObjectURL(blob);

        // Step 4: Create Audio element
        const audio = new Audio();
        audio.src = audioUrl;
        audio.preload = "auto";
        currentAudio = audio;

        audio.onended = () => {
            console.log("[Audio] Playback ended");
            finishAudio(audioUrl);
        };
        audio.onerror = (e) => {
            console.error("[Audio] Playback error:", audio.error?.message, e);
            finishAudio(audioUrl);
        };
        audio.onplaying = () => {
            // Keep speaking UI visible as long as media element is actively playing.
            setCoachSpeaking(true, "Nancy is speaking...");
        };

        // Step 5: Route through AudioContext to bypass autoplay restrictions
        const ctx = ensureAudioContextRunning();
        console.log(`[Audio] AudioContext state: ${ctx.state}`);
        try {
            const mediaNode = ctx.createMediaElementSource(audio);
            mediaNode.connect(ctx.destination);
            console.log("[Audio] Routed through AudioContext");
        } catch(e) {
            console.warn("[Audio] AudioContext routing failed, playing directly:", e);
        }

        // Step 6: Play
        const playResult = audio.play();
        if (playResult !== undefined) {
            playResult
                .then(() => {
                    console.log("[Audio] play() resolved — audio is playing");
                    // Some browsers miss 'ended' in edge cases; guard with a small watchdog.
                    playbackWatchdog = setInterval(() => {
                        if (!audio) return;
                        if (audio.ended) {
                            finishAudio(audioUrl);
                            return;
                        }
                        if (
                            !audio.paused &&
                            Number.isFinite(audio.duration) &&
                            audio.duration > 0 &&
                            (audio.duration - audio.currentTime) <= 0.08
                        ) {
                            finishAudio(audioUrl);
                        }
                    }, 250);
                })
                .catch(e => {
                    console.error("[Audio] play() rejected:", e);
                    finishAudio(audioUrl);
                });
        }

    } catch (e) {
        console.error("[Audio] Fatal error:", e);
        finishAudio(null);
    }
}



// ========== RECORDING FUNCTIONS ==========

function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
        recordingStatus.textContent = "Mic access denied - check permissions";
    }).then((stream) => {
        if (!stream) return;
        const options = { mimeType: "audio/webm;codecs=opus" };

        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = "audio/webm";
        }

        mediaRecorder = new MediaRecorder(stream, options);
        recordingChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordingChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            recordedBlob = new Blob(recordingChunks, { type: "audio/webm" });
            stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start();

        recordBtn.classList.remove("bg-gray-100", "text-gray-400");
        recordBtn.classList.add("bg-red-500", "text-white", "recording-active");
        micIcon.classList.add("hidden");
        stopIcon.classList.remove("hidden");
        recordingStatus.textContent = "Recording...";
        submitBtn.classList.add("hidden");
        endSessionBtn.disabled = true;
    });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();

        recordBtn.classList.remove("bg-red-500", "text-white", "recording-active");
        recordBtn.classList.add("bg-gray-100", "text-gray-400");
        micIcon.classList.remove("hidden");
        stopIcon.classList.add("hidden");
        recordingStatus.textContent = "Recording complete";
        submitBtn.classList.remove("hidden");
        submitBtn.disabled = false;
    }
}


// ========== API FUNCTIONS ==========

const startSessionApiUrl = "http://127.0.0.1:5001/start-session";


async function startSession() {
    // Unlock AudioContext immediately while still in user gesture (before any await)
    ensureAudioContextRunning();

    startSessionBtn.classList.add("hidden");
    recordBtn.classList.remove("hidden");
    setCoachSpeaking(true, "Connecting to Nancy...");

    try {
        const response = await fetch(startSessionApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: currentLanguage, scenario: currentScenario })
        });

        if (!response.ok) {
            let msg = "Failed to start session";
            try {
                const err = await response.json();
                msg = err.error || msg;
            } catch (_) {
                try { msg = await response.text(); } catch (_) {}
            }
            throw new Error(msg);
        }

        const contentType = response.headers.get("content-type");

        if (contentType && contentType.includes("text/plain")) {
            await handleAudioStream(response, () => {
                endSessionBtn.disabled = false;
            });
        } else {
            setCoachSpeaking(false);
            enableRecording();
            endSessionBtn.disabled = false;
        }
    } catch (error) {
        setCoachSpeaking(false);
        recordingStatus.textContent = `Start failed: ${error.message || "Backend not connected"}`;
        recordBtn.classList.add("hidden");
        startSessionBtn.classList.remove("hidden");
    }
}

const submitResponseApiUrl = "http://127.0.0.1:5001/submit-response";


async function submitResponse() {
    if (!recordedBlob) return;
    // Unlock AudioContext on this user gesture (submit button click)
    ensureAudioContextRunning();

    disableRecording();
    setCoachSpeaking(true, "Nancy is preparing a reply...");

    const formData = new FormData();
    formData.append("audio", recordedBlob, "response.webm");

    try {
        const response = await fetch(submitResponseApiUrl, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            let msg = "Submit failed";
            try {
                const err = await response.json();
                msg = err.error || msg;
            } catch (_) {
                try { msg = await response.text(); } catch (_) {}
            }
            throw new Error(msg);
        }

        const contentType = response.headers.get("content-type");
        const isComplete = response.headers.get('X-Session-Complete') === 'true';
        const exchangeNumber = response.headers.get('X-Exchange-Number');

        if (exchangeNumber) {
            updateExchangeNumber(exchangeNumber);
        }

        if (contentType && contentType.includes("text/plain")) {
            await handleAudioStream(response, () => {
                recordedBlob = null;
                recordingChunks = [];

                if (isComplete) {
                    // Audio already finished (onComplete called after onended)
                    showFeedbackSection();
                } else {
                    endSessionBtn.disabled = false;
                }
            });
        } else {
            setCoachSpeaking(false);
            recordedBlob = null;
            recordingChunks = [];

            if (isComplete) {
                showFeedbackSection();
            } else {
                enableRecording();
                endSessionBtn.disabled = false;
            }
        }
    } catch (error) {
        setCoachSpeaking(false);
        recordingStatus.textContent = `Connection error: ${error.message || "Unknown error"}`;
        enableRecording();
    }
}



async function endSession() {
    if (!confirm("End conversation and get feedback?")) return;

    disableRecording();
    endSessionBtn.disabled = true;
    recordingStatus.textContent = "Ending conversation...";

    await getFeedback();
}

const getFeedbackApiUrl = "http://127.0.0.1:5001/get-feedback";

async function getFeedback() {
    showFeedbackSection();
    getFeedbackBtn.textContent = "Generating...";
    getFeedbackBtn.disabled = true;

    try {
        const response = await fetch(getFeedbackApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (data.success) {
            displayFeedback(data.feedback);
        }
    } catch (error) {
        getFeedbackBtn.textContent = "Error - Retry";
        getFeedbackBtn.disabled = false;
    }
}


// ========== EVENT LISTENERS ==========

// Language card selection
langCards.forEach((card) => {
    card.addEventListener("click", () => {
        langCards.forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        selectedLanguage = card.dataset.lang;
        languageSelect.value = selectedLanguage;

        // Show scenario section
        scenarioSection.classList.remove("hidden");
        scenarioSection.scrollIntoView({ behavior: "smooth", block: "start" });

        // Reset scenario selection
        selectedScenario = null;
        scenarioOptions.forEach((c) => c.classList.remove("selected"));
        beginSessionBtn.disabled = true;
    });
});

// Scenario card selection
scenarioOptions.forEach((option) => {
    option.addEventListener("click", () => {
        scenarioOptions.forEach((c) => c.classList.remove("selected"));
        option.classList.add("selected");
        selectedScenario = option.dataset.scenario;
        scenarioSelect.value = selectedScenario;
        beginSessionBtn.disabled = false;
    });
});

beginSessionBtn.addEventListener("click", () => {
    if (!selectedLanguage || !selectedScenario) return;
    showSessionPanel(selectedLanguage, selectedScenario);
});

startSessionBtn.addEventListener("click", startSession);

recordBtn.addEventListener("click", () => {
    if (isSpeaking || recordBtn.disabled) return;

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        startRecording();
    } else {
        stopRecording();
    }
});

submitBtn.addEventListener("click", submitResponse);
endSessionBtn.addEventListener("click", endSession);
getFeedbackBtn.addEventListener("click", getFeedback);
newSessionBtn.addEventListener("click", resetToWelcome);


