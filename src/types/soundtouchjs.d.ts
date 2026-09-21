declare module "soundtouchjs" {
  export class PitchShifter {
    constructor(context: BaseAudioContext, buffer: AudioBuffer, bufferSize: number);
    tempo: number;
    pitchSemitones: number;
    percentagePlayed: number;
    connect(node: AudioNode): void;
    disconnect(): void;
  }
}