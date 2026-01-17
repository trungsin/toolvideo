/**
 * Vocal separation using Demucs
 * Wraps Python script for Node.js subprocess calls
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '../../../scripts');
const SCRIPT_PATH = join(SCRIPTS_DIR, 'demucs-separate.py');
const PYTHON_PATH = join(SCRIPTS_DIR, '.venv/bin/python3');
const TEMP_DIR = join(__dirname, '../../../temp');

/**
 * Separate vocals from audio using Demucs
 * @param {string} audioPath - Path to input audio file
 * @param {Object} options - Options
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Paths to vocals and instrumental
 */
export async function separateVocals(audioPath, options = {}) {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // Ensure temp dir exists
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const outputDir = join(TEMP_DIR, `separation_${Date.now()}`);

  return new Promise((resolve, reject) => {
    // Use venv Python if available, fallback to system Python
    const pythonCmd = existsSync(PYTHON_PATH) ? PYTHON_PATH : 'python3';
    const proc = spawn(pythonCmd, [SCRIPT_PATH, audioPath, outputDir]);
    let lastStatus = null;
    let resolved = false;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          lastStatus = msg;

          if (msg.error) {
            if (!resolved) {
              resolved = true;
              reject(new Error(msg.error));
            }
            return;
          }

          if (options.onProgress && msg.status) {
            options.onProgress(msg);
          }

          if (msg.status === 'complete' && !resolved) {
            resolved = true;
            resolve({
              vocals: msg.vocals,
              instrumental: msg.instrumental,
              sampleRate: msg.sample_rate
            });
          }
        } catch {
          // Not JSON, ignore
        }
      }
    });

    proc.stderr.on('data', (data) => {
      // Demucs prints progress to stderr
      const text = data.toString();
      if (options.onProgress && text.includes('%')) {
        const match = text.match(/(\d+)%/);
        if (match) {
          options.onProgress({ status: 'separating', progress: parseInt(match[1]) });
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0 && !resolved) {
        resolved = true;
        reject(new Error(`Demucs process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to run demucs: ${err.message}. Is Python3 installed?`));
      }
    });
  });
}

/**
 * Check if Demucs is installed
 * @returns {Promise<boolean>}
 */
export async function isDemucsAvailable() {
  return new Promise((resolve) => {
    const pythonCmd = existsSync(PYTHON_PATH) ? PYTHON_PATH : 'python3';
    const proc = spawn(pythonCmd, ['-c', 'import demucs; print("ok")']);
    let resolved = false;

    proc.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        resolve(code === 0);
      }
    });

    proc.on('error', () => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });

    // Timeout after 10s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, 10000);
  });
}

/**
 * Get Demucs installation instructions
 * @returns {string}
 */
export function getInstallInstructions() {
  return `Demucs not installed. Install with:
  pip install demucs

Or with conda:
  conda install -c conda-forge demucs`;
}
