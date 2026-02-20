# Voice Guide (DE)

## Woher kommen die Stimmen?

Aktuell aus der Browser-/OS-TTS-Engine über Web Speech API (`speechSynthesis`).

- Windows/Edge/Chrome: installierte Systemstimmen
- Auswahl im UI: Geräteliste + Presets (`egirl-cute`, `warm-coach`, `clear-pro`)

## Wie ist es eingebaut?

- Frontend OOP: `VoiceInterface` in `web/app.js`
- Backend-Persistenz: `GET/POST /assistant/voice/settings`, `GET /assistant/voice/config`
- Gespeichert pro Character/User in `modeExtras.voiceSettings`

## Wie erweitere ich neue Stimmen?

1. In `src/services/CompanionLLMService.js` im Array `VOICE_PRESETS` neuen Preset ergänzen.
2. Optional im Frontend in `VoiceInterface.resolveVoice()` weitere Namenspräferenzen ergänzen.
3. Settings speichern (`Voice speichern` im UI).

## Ist das „State of the Art“?

Für schnellen lokalen MVP: ja (einfach, robust, kein extra Inferenzserver).

Für maximale Qualität (natürlichste Stimme + bestes STT):

- STT: Whisper/Deepgram/Azure Speech
- TTS: ElevenLabs/Azure Neural TTS/OpenAI TTS
- Optional VAD/Realtime-Pipeline für Dialogfluss

## Muss man Voice trainieren?

Nicht zwingend. In der Regel nutzt man vortrainierte STT/TTS-Modelle als API.
Eigenes Training lohnt erst bei starker Domain-/Speaker-Anpassung.
