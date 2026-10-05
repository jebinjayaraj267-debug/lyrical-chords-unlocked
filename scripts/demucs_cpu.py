"""Run Demucs with CPU-friendly audio I/O that bypasses TorchCodec."""

import sys

import soundfile
import torch
import torchaudio


def load_audio(path: str, *args, **kwargs):
    samples, sample_rate = soundfile.read(path, dtype="float32", always_2d=True)
    return torch.from_numpy(samples.T.copy()), sample_rate


def save_audio(path: str, audio: torch.Tensor, sample_rate: int, *args, **kwargs):
    samples = audio.detach().cpu().numpy().T
    soundfile.write(path, samples, sample_rate, subtype="PCM_16")


torchaudio.load = load_audio
torchaudio.save = save_audio

from demucs.separate import main


if __name__ == "__main__":
    sys.exit(main())