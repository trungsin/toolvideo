/**
 * Shared yt-dlp argument builder for MP3 extraction.
 * Uses VBR ~192kbps with metadata, embedded thumbnail, and ID3v2.3 tags.
 */

export const AUDIO_EXT = 'mp3';
export const AUDIO_QUALITY = 'mp3-vbr-192';

export function buildAudioArgs() {
  return [
    '-x',
    '--audio-format',
    AUDIO_EXT,
    '--audio-quality',
    '5',
    '--embed-thumbnail',
    '--add-metadata',
    '--postprocessor-args',
    'ffmpeg:-id3v2_version 3',
  ];
}
