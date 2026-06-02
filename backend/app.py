import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langgraph.checkpoint.memory import InMemorySaver
from langchain.agents import create_agent
import assemblyai as aai
import os
import base64
import requests
import tempfile
import json
import datetime
import time
import re

load_dotenv()

# ─────────────────────────────────────────────
# DEBUG HELPER
# ─────────────────────────────────────────────
def log(step, message, level="INFO"):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    icons = {"INFO": "ℹ️ ", "OK": "✅", "ERROR": "❌", "WARN": "⚠️ ", "API": "🔑", "STEP": "▶️ "}
    icon = icons.get(level, "  ")
    print(f"[{ts}] {icon} [{step}] {message}")

def mask_key(key):
    """Show first 6 and last 4 chars of an API key for debug display."""
    if not key:
        return "NOT SET ❌"
    if len(key) <= 10:
        return "***SET (short)***"
    return f"{key[:6]}...{key[-4:]} ✅"

def invoke_agent_with_retry(agent_obj, input_data, config, max_retries=3, initial_delay=2):
    delay = initial_delay
    for attempt in range(max_retries):
        try:
            return agent_obj.invoke(input_data, config=config)
        except Exception as e:
            error_str = str(e)
            is_rate_limit = "429" in error_str or "RESOURCE_EXHAUSTED" in error_str
            if is_rate_limit and attempt < max_retries - 1:
                wait_time = delay
                match = re.search(r"retry in ([\d\.]+)s", error_str)
                if match:
                    try:
                        wait_time = float(match.group(1)) + 0.5
                    except ValueError:
                        pass
                log("RETRY", f"Gemini API rate limit hit. Waiting {wait_time:.1f}s before retry (Attempt {attempt+1}/{max_retries})...", "WARN")
                time.sleep(wait_time)
                delay *= 2
            else:
                raise


def message_content_to_text(content):
    """Normalize LangChain message content to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join([p for p in parts if p]).strip()
    if content is None:
        return ""
    return str(content)

# ─────────────────────────────────────────────
# STARTUP — API KEY VALIDATION
# ─────────────────────────────────────────────
GOOGLE_API_KEY    = os.getenv("GOOGLE_API_KEY")
MURF_API_KEY      = os.getenv("MURF_API_KEY")
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")

print("\n" + "="*60)
print("  LinguaAI Backend — API Key Status Check")
print("="*60)
log("STARTUP", f"GOOGLE_API_KEY     : {mask_key(GOOGLE_API_KEY)}",     "API")
log("STARTUP", f"MURF_API_KEY       : {mask_key(MURF_API_KEY)}",       "API")
log("STARTUP", f"ASSEMBLYAI_API_KEY : {mask_key(ASSEMBLYAI_API_KEY)}", "API")

_all_keys_ok = all([GOOGLE_API_KEY, MURF_API_KEY, ASSEMBLYAI_API_KEY])
if _all_keys_ok:
    log("STARTUP", "All API keys loaded successfully", "OK")
else:
    log("STARTUP", "One or more API keys are MISSING — features will fail!", "ERROR")
print("="*60 + "\n")

# ─────────────────────────────────────────────
# INIT ASSEMBLYAI
# ─────────────────────────────────────────────
log("STARTUP", "Configuring AssemblyAI client...", "STEP")
aai.settings.api_key = ASSEMBLYAI_API_KEY
log("STARTUP", "AssemblyAI client configured", "OK")

# ─────────────────────────────────────────────
# INIT GEMINI MODEL
# ─────────────────────────────────────────────
log("STARTUP", "Initialising Gemini 2.5 Flash model (google_genai)...", "STEP")
checkpointer = InMemorySaver()
try:
    model = init_chat_model(
        "google_genai:gemini-2.5-flash",
        api_key=GOOGLE_API_KEY
    )
    log("STARTUP", "Gemini model initialised OK", "OK")
except Exception as e:
    log("STARTUP", f"Gemini model FAILED to initialise: {e}", "ERROR")
    raise

log("STARTUP", "Creating LangGraph agent with InMemorySaver checkpointer...", "STEP")
try:
    agent = create_agent(
        model=model,
        tools=[],
        checkpointer=checkpointer
    )
    log("STARTUP", "LangGraph agent created OK", "OK")
except Exception as e:
    log("STARTUP", f"LangGraph agent FAILED to create: {e}", "ERROR")
    raise

exchange_count = 0
current_language = ""
current_scenario = ""
thread_id = "conversation_session"

LANGUAGE_CODES = {
    "French": "fr", "Spanish": "es", "Hindi": "hi",
    "Japanese": "ja", "German": "de", "Telugu": "te", "Tamil": "ta"
}

MURF_VOICE_MAP = {
    "French":   {"voiceId": "fr-FR-axel", "multiNativeLocale": "fr-FR"},
    "Spanish":  {"voiceId": "es-ES-elvira", "multiNativeLocale": "es-ES"},
    "Hindi":    {"voiceId": "hi-IN-namrita", "multiNativeLocale": "hi-IN"},
    "Japanese": {"voiceId": "ja-JP-kimi", "multiNativeLocale": "ja-JP"},
    "German":   {"voiceId": "de-DE-josephine", "multiNativeLocale": "de-DE"},
    "Telugu":   {"voiceId": "te-IN-navya", "multiNativeLocale": "te-IN"},
    "Tamil":    {"voiceId": "ta-IN-abirami", "multiNativeLocale": "ta-IN"},
}

SESSION_PROMPT = """You are Nancy, a patient and encouraging language conversation partner helping someone practice {language} through a realistic "{scenario}" scenario.

IMPORTANT GUIDELINES:
1. Conduct exactly 5 conversational exchanges total throughout the session
2. Speak ONLY in {language} for the main conversation
3. After each of your {language} responses, add a correction or tip in English inside [brackets] like:
   [Tip: "Je voudrais" is more polite than "Je veux"]
4. Keep your {language} responses SHORT and CRISP (1-2 sentences maximum)
5. ALWAYS reference what the learner ACTUALLY said in their previous response - do NOT make up or assume their responses
6. Adapt difficulty based on their ACTUAL level - simplify if they struggle, challenge if they're strong
7. Be warm and conversational but CONCISE
8. Stay in the "{scenario}" scenario throughout

CRITICAL: Read the conversation history carefully. Only acknowledge what the learner truly said, not what you think they might have said.

Keep it short, conversational, and adaptive!"""


FEEDBACK_PROMPT = """Based on our complete conversation session, provide detailed feedback as JSON only:
    {{
    "language": "<language practiced>",
    "scenario": "<scenario practiced>",
    "fluency_score": <1-10>,
    "grammar_accuracy": <1-10>,
    "vocabulary_range": "<basic/moderate/advanced>",
    "grammar_mistakes": [
        {{"said": "<what they said>", "correct": "<correct form>", "rule": "<grammar rule>"}}
    ],
    "new_words_to_learn": ["word1", "word2", "word3"],
    "conversation_tip": "<practical tip for improvement>"
    }}
    Be specific - reference ACTUAL things they said during the conversation."""


# ─────────────────────────────────────────────
# FLASK APP
# ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, expose_headers=['X-Exchange-Number', 'X-Session-Complete'])
log("STARTUP", "Flask app + CORS configured (origins=*, expose headers)", "OK")


# ─────────────────────────────────────────────
# HELPER: MURF TTS STREAM
# ─────────────────────────────────────────────
def stream_audio(text):
    BASE_URL = "https://global.api.murf.ai/v1/speech/stream"
    log("MURF-TTS", f"MURF_API_KEY status: {mask_key(MURF_API_KEY)}", "API")
    log("MURF-TTS", f"Requesting TTS for language='{current_language}' | text length={len(text)} chars", "STEP")
    if not text or not text.strip():
        log("MURF-TTS", "Skipping TTS because text is empty", "WARN")
        return

    voice_config = MURF_VOICE_MAP.get(current_language, {"voiceId": "en-US-cooper", "multiNativeLocale": "en-US"})
    log("MURF-TTS", f"Voice config: voiceId={voice_config['voiceId']}, locale={voice_config['multiNativeLocale']}", "INFO")

    payload = {
        "text": text,
        "voiceId": voice_config["voiceId"],
        "model": "FALCON",
        "multiNativeLocale": voice_config["multiNativeLocale"],
        "sampleRate": 24000,
        "format": "MP3",
    }
    headers = {
        "Content-Type": "application/json",
        "api-key": MURF_API_KEY
    }

    try:
        response = requests.post(
            BASE_URL,
            headers=headers,
            data=json.dumps(payload),
            stream=True,
            timeout=90
        )
        log("MURF-TTS", f"Murf API response status: {response.status_code}", "OK" if response.status_code == 200 else "ERROR")

        if response.status_code != 200:
            log("MURF-TTS", f"Murf API error body: {response.text[:300]}", "ERROR")
            return

        chunk_count = 0
        for chunk in response.iter_content(chunk_size=4096):
            if chunk:
                chunk_count += 1
                yield base64.b64encode(chunk).decode("utf-8") + "\n"

        log("MURF-TTS", f"Audio streaming complete — {chunk_count} chunk(s) sent", "OK")

    except Exception as e:
        log("MURF-TTS", f"Murf TTS request FAILED: {e}", "ERROR")
        return


# ─────────────────────────────────────────────
# HELPER: ASSEMBLYAI STT
# ─────────────────────────────────────────────
def speech_to_text(audio_path):
    """Convert audio file to text using AssemblyAI"""
    log("ASSEMBLYAI", f"ASSEMBLYAI_API_KEY status: {mask_key(ASSEMBLYAI_API_KEY)}", "API")
    log("ASSEMBLYAI", f"Transcribing audio file: {audio_path}", "STEP")
    lang_code = LANGUAGE_CODES.get(current_language, "en")
    log("ASSEMBLYAI", f"Using language code: '{lang_code}' for '{current_language}'", "INFO")

    try:
        transcriber = aai.Transcriber()
        config = aai.TranscriptionConfig(
            speech_models=["universal-3-pro", "universal-2"],
            language_code=lang_code,
            speaker_labels=True,
        )
        transcript = transcriber.transcribe(audio_path, config=config)
        result = transcript.text if transcript.text else ""
        log("ASSEMBLYAI", f"Transcription result: '{result[:100]}{'...' if len(result) > 100 else ''}'", "OK" if result else "WARN")
        return result
    except Exception as e:
        log("ASSEMBLYAI", f"AssemblyAI transcription FAILED: {e}", "ERROR")
        return ""


# ─────────────────────────────────────────────
# ENDPOINT: POST /start-session
# ─────────────────────────────────────────────
@app.route("/start-session", methods=["POST"])
def start_session():
    global current_language, current_scenario, exchange_count, agent, checkpointer
    print("\n" + "-"*50)
    log("POST /start-session", "Request received", "STEP")

    data = request.get_json(silent=True) or {}
    current_language = data.get("language", "French")
    current_scenario = data.get("scenario", "ordering food")
    log("POST /start-session", f"Language='{current_language}', Scenario='{current_scenario}'", "INFO")

    # Step 1 — Reset session
    log("POST /start-session", "Step 1/4 — Resetting session (new InMemorySaver + agent)", "STEP")
    exchange_count = 1
    checkpointer = InMemorySaver()
    try:
        agent = create_agent(model=model, tools=[], checkpointer=checkpointer)
        log("POST /start-session", "New agent created OK", "OK")
    except Exception as e:
        log("POST /start-session", f"Agent creation FAILED: {e}", "ERROR")
        return jsonify({"error": str(e)}), 500

    # Step 2 — Format prompt
    log("POST /start-session", "Step 2/4 — Formatting session prompt", "STEP")
    config = {"configurable": {"thread_id": thread_id}}
    formatted_prompt = SESSION_PROMPT.format(language=current_language, scenario=current_scenario)
    log("POST /start-session", f"Prompt formatted ({len(formatted_prompt)} chars)", "OK")

    # Step 3 — Call Gemini
    log("POST /start-session", f"Step 3/4 — Calling Gemini (GOOGLE_API_KEY: {mask_key(GOOGLE_API_KEY)})", "API")
    try:
        response = invoke_agent_with_retry(agent, {
            "messages": [
                {"role": "system", "content": formatted_prompt},
                {"role": "user", "content": f"Start the conversation with a warm greeting in {current_language} and set up the '{current_scenario}' scenario. Keep it SHORT (1-2 sentences). Add a [Tip] in English for any key phrase you use."}
            ]
        }, config=config)
        message = message_content_to_text(response["messages"][-1].content)
        if not message:
            raise ValueError("Model returned an empty response")
        log("POST /start-session", f"Gemini response received ({len(message)} chars)", "OK")
        print(f"   💬 Nancy: {message}")
    except Exception as e:
        log("POST /start-session", f"Gemini call FAILED: {e}", "ERROR")
        return jsonify({"error": str(e)}), 500

    # Step 4 — Stream audio via Murf
    log("POST /start-session", "Step 4/4 — Streaming audio via Murf TTS", "STEP")
    print("-"*50)
    return Response(
        stream_audio(message),
        mimetype='text/plain',
        headers={'Content-Type': 'text/plain'}
    )


# ─────────────────────────────────────────────
# ENDPOINT: POST /submit-response
# ─────────────────────────────────────────────
@app.route("/submit-response", methods=["POST"])
def submit_response():
    """Process user's response and generate next exchange"""
    global exchange_count
    print("\n" + "-"*50)
    log("POST /submit-response", f"Request received — current exchange_count={exchange_count}", "STEP")

    # Step 1 — Save audio to temp file
    log("POST /submit-response", "Step 1/4 — Saving uploaded audio to temp file", "STEP")
    try:
        audio_file = request.files["audio"]
        temp_path = tempfile.NamedTemporaryFile(delete=False, suffix=".webm").name
        audio_file.save(temp_path)
        log("POST /submit-response", f"Audio saved to: {temp_path}", "OK")
    except Exception as e:
        log("POST /submit-response", f"Audio save FAILED: {e}", "ERROR")
        return jsonify({"error": str(e)}), 500

    # Step 2 — Transcribe via AssemblyAI
    log("POST /submit-response", "Step 2/4 — Transcribing audio with AssemblyAI", "STEP")
    answer = speech_to_text(temp_path)
    os.unlink(temp_path)
    log("POST /submit-response", f"Temp file deleted", "INFO")

    if not answer or answer.strip() == "":
        answer = "[Learner provided a verbal response]"
        log("POST /submit-response", "Empty transcript — using fallback answer", "WARN")
    else:
        log("POST /submit-response", f"Learner said: '{answer}'", "OK")

    # Step 3 — Send learner answer to agent memory and call Gemini for next response
    exchange_count += 1
    log("POST /submit-response", f"Step 3/4 — Calling Gemini for exchange {exchange_count} (GOOGLE_API_KEY: {mask_key(GOOGLE_API_KEY)})", "API")
    config = {"configurable": {"thread_id": thread_id}}
    try:
        response = invoke_agent_with_retry(agent, {"messages": [{"role": "user", "content": answer}]}, config=config)
        message = message_content_to_text(response["messages"][-1].content)
        if not message:
            raise ValueError("Model returned an empty response")
        log("POST /submit-response", f"Gemini response received ({len(message)} chars)", "OK")
        print(f"   💬 Nancy (Exchange {exchange_count}): {message}")
    except Exception as e:
        log("POST /submit-response", f"Gemini call FAILED: {e}", "ERROR")
        return jsonify({"error": str(e)}), 500

    # Step 4 — Stream audio via Murf
    log("POST /submit-response", "Step 4/4 — Streaming audio via Murf TTS", "STEP")
    print("-"*50)
    
    headers = {'X-Exchange-Number': str(exchange_count)}
    if exchange_count >= 5:
        headers['X-Session-Complete'] = 'true'
        log("POST /submit-response", "Conversation complete — setting X-Session-Complete header", "INFO")

    return Response(
        stream_audio(message),
        mimetype='text/plain',
        headers=headers
    )


# ─────────────────────────────────────────────
# ENDPOINT: POST /get-feedback
# ─────────────────────────────────────────────
@app.route("/get-feedback", methods=["POST"])
def get_feedback():
    """Generate detailed conversation feedback"""
    print("\n" + "-"*50)
    log("POST /get-feedback", "Request received", "STEP")
    log("POST /get-feedback", f"Session: language='{current_language}', scenario='{current_scenario}'", "INFO")

    # Step 1 — Call Gemini for feedback JSON
    log("POST /get-feedback", f"Step 1/3 — Calling Gemini for feedback (GOOGLE_API_KEY: {mask_key(GOOGLE_API_KEY)})", "API")
    config = {"configurable": {"thread_id": thread_id}}
    try:
        response = invoke_agent_with_retry(agent, {
            "messages": [{
                "role": "user",
                "content": f"{FEEDBACK_PROMPT}\n\nReview our complete {current_language} conversation about '{current_scenario}' and provide detailed feedback."
            }]
        }, config=config)
        text = message_content_to_text(response["messages"][-1].content)
        if not text:
            raise ValueError("Model returned empty feedback content")
        log("POST /get-feedback", f"Gemini feedback response received ({len(text)} chars)", "OK")
    except Exception as e:
        log("POST /get-feedback", f"Gemini call FAILED: {e}", "ERROR")
        return jsonify({"success": False, "error": str(e)}), 500

    # Step 2 — Parse JSON from response
    log("POST /get-feedback", "Step 2/3 — Parsing feedback JSON from Gemini response", "STEP")
    try:
        cleaned = text.strip()
        if "```" in cleaned:
            cleaned = cleaned.split("```")[1].replace("json", "").strip()
            log("POST /get-feedback", "Stripped markdown code fences from JSON", "INFO")
        else:
            start = cleaned.find("{")
            end = cleaned.rfind("}") + 1
            if start != -1 and end > start:
                cleaned = cleaned[start:end]
                log("POST /get-feedback", "Extracted JSON via brace detection", "INFO")

        feedback = json.loads(cleaned)
        log("POST /get-feedback", f"JSON parsed OK — fluency={feedback.get('fluency_score')}, grammar={feedback.get('grammar_accuracy')}", "OK")
        print(f"   📊 Feedback: {json.dumps(feedback, ensure_ascii=False, indent=2)[:300]}...")
    except Exception as e:
        log("POST /get-feedback", f"JSON parsing FAILED: {e}", "ERROR")
        log("POST /get-feedback", f"Raw text was: {text[:300]}", "INFO")
        return jsonify({"success": False, "error": f"JSON parse error: {e}"}), 500

    # Step 3 — Return response
    log("POST /get-feedback", "Step 3/3 — Returning feedback JSON to client", "OK")
    print("-"*50)
    return jsonify({"success": True, "feedback": feedback})


# ─────────────────────────────────────────────
# RUN
# ─────────────────────────────────────────────
log("STARTUP", "Starting Flask server on port 5001...", "STEP")
app.run(debug=True, port=5001)
