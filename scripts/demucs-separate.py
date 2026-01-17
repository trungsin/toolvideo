#!/usr/bin/env python3
"""
Demucs vocal separation script
Separates audio into vocals and instrumental tracks
Usage: python demucs-separate.py <audio_file> <output_dir>
"""

import sys
import os
import json
import torch
from pathlib import Path

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: demucs-separate.py <audio> <output_dir>"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    # Detect device
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    print(json.dumps({"status": "starting", "device": device}), flush=True)

    try:
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import soundfile as sf
        import numpy as np

        # Load model
        print(json.dumps({"status": "loading_model"}), flush=True)
        model = get_model("htdemucs")
        model.to(device)
        model.eval()

        # Load audio using soundfile (more compatible)
        print(json.dumps({"status": "loading_audio"}), flush=True)
        audio_data, sr = sf.read(audio_path)

        # Convert to torch tensor (channels, samples)
        if audio_data.ndim == 1:
            # Mono to stereo
            audio_data = np.stack([audio_data, audio_data])
        else:
            # Transpose to (channels, samples)
            audio_data = audio_data.T

        wav = torch.from_numpy(audio_data.astype(np.float32))

        # Resample if needed
        if sr != model.samplerate:
            import torchaudio
            wav = torchaudio.functional.resample(wav, sr, model.samplerate)
            sr = model.samplerate

        # Add batch dimension
        wav = wav.unsqueeze(0).to(device)

        # Separate
        print(json.dumps({"status": "separating", "progress": 0}), flush=True)
        with torch.no_grad():
            sources = apply_model(model, wav, device=device, progress=True)

        # sources shape: (batch, sources, channels, samples)
        # htdemucs sources: drums, bass, other, vocals
        sources = sources.squeeze(0)  # Remove batch dim

        # Get vocals and instrumental (drums + bass + other)
        source_names = model.sources
        vocals_idx = source_names.index("vocals")

        vocals = sources[vocals_idx]
        instrumental = sources[[i for i in range(len(source_names)) if i != vocals_idx]].sum(0)

        # Save outputs
        os.makedirs(output_dir, exist_ok=True)

        vocals_path = os.path.join(output_dir, "vocals.wav")
        instrumental_path = os.path.join(output_dir, "instrumental.wav")

        # Save using soundfile (transpose to samples, channels)
        sf.write(vocals_path, vocals.cpu().numpy().T, sr)
        sf.write(instrumental_path, instrumental.cpu().numpy().T, sr)

        print(json.dumps({
            "status": "complete",
            "vocals": vocals_path,
            "instrumental": instrumental_path,
            "sample_rate": sr
        }), flush=True)

    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
