/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @google/genai-api: Fix: Refactored to use Session Promise to prevent race conditions.
import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils.js';
import './visual-3d.js';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  // @google/genai-api: Fix: Update default voice and remove invalid voice option.
  @state() selectedVoice = 'Zephyr';
  @state() isSettingsOpen = false;

  private readonly voices = [
    'Zephyr',
    'Puck',
    'Charon',
    'Kore',
    'Fenrir',
  ];

  private client: GoogleGenAI;
  // @google/genai-api: Fix: Use a promise for the session to avoid race conditions.
  private sessionPromise: Promise<Session>;
  // @google/genai-api: Fix: Cast window to any to resolve TypeScript error for webkitAudioContext.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  // @google/genai-api: Fix: Cast window to any to resolve TypeScript error for webkitAudioContext.
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: #333;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;

      button {
        outline: none;
        border: 1px solid #e0e0e0;
        color: #333;
        border-radius: 50%;
        background: #f0f0f0;
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;

        &:hover {
          background: #e0e0e0;
        }
      }

      button[disabled] {
        display: none;
      }
    }

    .settings-toggle {
      position: absolute;
      top: 20px;
      right: 20px;
      z-index: 20;
      outline: none;
      border: 1px solid #e0e0e0;
      color: #333;
      border-radius: 50%;
      background: #f0f0f0;
      width: 48px;
      height: 48px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s, transform 0.2s;

      &:hover {
        background: #e0e0e0;
        transform: rotate(15deg);
      }
    }

    .settings-panel {
      position: absolute;
      top: 80px;
      right: 20px;
      z-index: 19;
      background: #ffffff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 15px;
      transform: translateY(-20px);
      opacity: 0;
      visibility: hidden;
      transition: transform 0.3s ease, opacity 0.3s ease, visibility 0.3s;
    }

    .settings-panel.open {
      transform: translateY(0);
      opacity: 1;
      visibility: visible;
    }

    .settings-panel label {
      color: #333;
      font-size: 14px;
    }

    .settings-panel select {
      outline: none;
      border: 1px solid #ccc;
      color: #333;
      border-radius: 8px;
      background: #f9f9f9;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 16px;
      -webkit-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23333' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 0.7rem center;
      background-size: 1em;
      padding-right: 2.5rem;
      transition: background-color 0.2s;

      &:hover {
        background-color: #f0f0f0;
      }
    }

    .settings-panel .voice-selector {
      display: flex;
      flex-direction: column;
      gap: 5px;
      align-items: flex-start;
    }

    .settings-panel button {
      outline: none;
      border: 1px solid #e0e0e0;
      color: #333;
      border-radius: 8px;
      background: #f9f9f9;
      padding: 10px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background-color 0.2s;

      &:hover {
        background-color: #f0f0f0;
      }
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    this.sessionPromise = this.client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          this.updateStatus('Opened');
        },
        onmessage: async (message: LiveServerMessage) => {
          const audio =
            message.serverContent?.modelTurn?.parts[0]?.inlineData;

          if (audio) {
            this.nextStartTime = Math.max(
              this.nextStartTime,
              this.outputAudioContext.currentTime,
            );

            const audioBuffer = await decodeAudioData(
              decode(audio.data),
              this.outputAudioContext,
              24000,
              1,
            );
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputNode);
            source.addEventListener('ended', () => {
              this.sources.delete(source);
            });

            source.start(this.nextStartTime);
            this.nextStartTime = this.nextStartTime + audioBuffer.duration;
            this.sources.add(source);
          }

          const interrupted = message.serverContent?.interrupted;
          if (interrupted) {
            for (const source of this.sources.values()) {
              source.stop();
              this.sources.delete(source);
            }
            this.nextStartTime = 0;
          }
        },
        onerror: (e: ErrorEvent) => {
          this.updateError(e.message);
        },
        onclose: (e: CloseEvent) => {
          this.updateStatus('Close:' + e.reason);
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {voiceName: this.selectedVoice},
          },
        },
        systemInstruction:
          "When asked who created you or who trained you, respond with: 'I was trained by CloseAI's, an AI company designed to help people with tasks. The founder of CloseAI's is Anubhav Sapkota. He is 12 years old, and he is the world's youngest entrepreneur of AI.' Only if you are asked who Anubhav's friend is, then you should respond with: 'One of his best friends is Ahmed Qamar. Ahmed is a good and real friend of Daksh. Daksh is good, but he is a little greedy and wants Anubhav not to be friends with Ahmed.'",
      },
    });

    this.sessionPromise.catch((e) => {
      console.error(e);
      this.updateError(e.message);
    });
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 4096;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording...');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped.');
  }

  private reset() {
    this.sessionPromise?.then((session) => session.close());
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  private handleVoiceChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    this.selectedVoice = target.value;
    this.reset();
  }

  private toggleSettings() {
    this.isSettingsOpen = !this.isSettingsOpen;
  }

  render() {
    return html`
      <div>
        <button class="settings-toggle" @click=${this.toggleSettings}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            stroke="#333"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round">
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 0 2l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1 0-2l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>

        <div class="settings-panel ${this.isSettingsOpen ? 'open' : ''}">
          <div class="voice-selector">
            <label for="voice-select">Voice:</label>
            <select
              id="voice-select"
              @change=${this.handleVoiceChange}
              ?disabled=${this.isRecording}>
              ${this.voices.map(
                (voice) =>
                  html`<option
                    value=${voice}
                    ?selected=${this.selectedVoice === voice}>
                    ${voice}
                  </option>`,
              )}
            </select>
          </div>
          <button @click=${this.reset} ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="20px"
              viewBox="0 -960 960 960"
              width="20px"
              fill="#333333">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
            Reset Session
          </button>
        </div>

        <div class="controls">
          <button @click=${this.isRecording ? this.stopRecording : this.startRecording}>
            ${
              this.isRecording
                ? html`
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="#333">
                      <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                    </svg>
                  `
                : html`
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      stroke="#333"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round">
                      <path
                        d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                      <line x1="12" y1="19" x2="12" y2="23"></line>
                    </svg>
                  `
            }
          </button>
        </div>

        <div id="status"> ${this.error || this.status} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}