package com.firefly.luma;

import android.content.Intent;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;

/**
 * The phone's speech recognizer, shaped like the browser's SpeechRecognition so the page's
 * listening code works unchanged: one listening session per start(), results and the end of the
 * session go to window.__nativeSpeech. The page restarts it when it wants to keep listening;
 * while it does, the recognizer's start beep is muted.
 */
class Speech implements RecognitionListener {
    private final MainActivity app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer sr;
    private boolean active, muted;
    private final Runnable unmute = () -> mute(false);

    Speech(MainActivity app) { this.app = app; }

    void start(String lang) {
        main.removeCallbacks(unmute);
        if (sr == null) {
            sr = SpeechRecognizer.createSpeechRecognizer(app);
            sr.setRecognitionListener(this);
        }
        if (active) sr.cancel();
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang == null || lang.isEmpty() ? "en-US" : lang)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, app.getPackageName());
        mute(true);
        active = true;
        sr.startListening(i);
    }

    void stop() {
        if (sr != null && active) sr.cancel();
        if (active) end();
        main.postDelayed(unmute, 500);
    }

    void fail(String error) { send("error", error, null, true); send("end", null, null, true); }

    void destroy() { if (sr != null) sr.destroy(); sr = null; mute(false); }

    private void end() {
        active = false;
        send("end", null, null, true);
        // if the page doesn't start again soon, sounds come back
        main.postDelayed(unmute, 2500);
    }

    private void send(String type, String error, ArrayList<String> alts, boolean fin) {
        try {
            JSONObject o = new JSONObject().put("type", type).put("final", fin);
            if (error != null) o.put("error", error);
            if (alts != null) o.put("alts", new JSONArray(alts));
            app.js("window.__nativeSpeech && __nativeSpeech(" + o + ")");
        } catch (Exception ignored) { }
    }

    // the recognizer's start/stop beeps
    private void mute(boolean on) {
        if (muted == on) return;
        muted = on;
        AudioManager am = (AudioManager) app.getSystemService(MainActivity.AUDIO_SERVICE);
        for (int stream : new int[]{AudioManager.STREAM_NOTIFICATION, AudioManager.STREAM_SYSTEM}) {
            try { am.adjustStreamVolume(stream, on ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE, 0); }
            catch (Exception ignored) { }   // e.g. Do Not Disturb is on
        }
    }

    @Override public void onResults(Bundle b) {
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r != null && !r.isEmpty()) send("result", null, r, true);
        end();
    }

    @Override public void onPartialResults(Bundle b) {
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r != null && !r.isEmpty() && !r.get(0).isEmpty()) send("result", null, r, false);
    }

    @Override public void onError(int e) {
        String code;
        switch (e) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: code = "no-speech"; break;
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: code = "not-allowed"; break;
            case SpeechRecognizer.ERROR_AUDIO: code = "audio-capture"; break;
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: code = "network"; break;
            default: code = "aborted";
        }
        send("error", code, null, true);
        end();
    }

    @Override public void onReadyForSpeech(Bundle b) { }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float v) { }
    @Override public void onBufferReceived(byte[] bytes) { }
    @Override public void onEndOfSpeech() { }
    @Override public void onEvent(int t, Bundle b) { }
}
