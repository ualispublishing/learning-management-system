/**
 * @fileoverview src/lib/audio/player.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer as ExpoAudioPlayer,
  type AudioSource,
} from 'expo-audio';
import { DIAGNOSTIC_CONTEXTS, logDiagnosticWarning } from '../diagnosticLog';

export class AudioPlayer {
  private static instance: AudioPlayer;
  private sound: ExpoAudioPlayer | null = null;
  private isPlaying: boolean = false;

  private constructor() {}

  public static getInstance(): AudioPlayer {
    if (!AudioPlayer.instance) {
      AudioPlayer.instance = new AudioPlayer();
    }
    return AudioPlayer.instance;
  }

  /**
   * Initializes audio settings for the app.
   */
  public async init() {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });
    } catch (err) {
      logDiagnosticWarning(DIAGNOSTIC_CONTEXTS.audioModeConfiguration, err);
    }
  }

  /**
   * Play an ambient looping sound.
   * Note: You must provide a valid required module source, e.g., require('../../assets/ambient.mp3')
   */
  public async playAmbient(source: AudioSource, volume: number = 0.5) {
    let nextSound: ExpoAudioPlayer | null = null;
    try {
      if (this.sound) {
        await this.stop();
      }

      nextSound = createAudioPlayer(source, { keepAudioSessionActive: true });
      nextSound.loop = true;
      nextSound.volume = Math.max(0, Math.min(1, volume));
      nextSound.play();
      this.sound = nextSound;
      this.isPlaying = true;
    } catch (err) {
      nextSound?.remove();
      logDiagnosticWarning(DIAGNOSTIC_CONTEXTS.ambientAudioPlayback, err);
    }
  }

  public async setVolume(volume: number) {
    if (this.sound) {
      this.sound.volume = Math.max(0, Math.min(1, volume));
    }
  }

  public async stop() {
    if (this.sound) {
      try {
        this.sound.pause();
        this.sound.remove();
      } catch (err) {
        logDiagnosticWarning(DIAGNOSTIC_CONTEXTS.ambientAudioStop, err);
      } finally {
        this.sound = null;
        this.isPlaying = false;
      }
    }
  }

  public async togglePause() {
    if (this.sound) {
      if (this.isPlaying) {
        this.sound.pause();
        this.isPlaying = false;
      } else {
        this.sound.play();
        this.isPlaying = true;
      }
    }
  }

  public isActive(): boolean {
    return this.isPlaying;
  }
}

export const audioPlayer = AudioPlayer.getInstance();
