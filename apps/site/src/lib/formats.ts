/** what Tramme writes: `tramme render` (video, frames) and `tramme export`
 *  (vectors, sound); the editor writes them all in the browser but MOV */
export const FORMATS = [
  { name: 'MP4', what: 'H.264, or H.265 in 10 bits' },
  { name: 'MOV', what: 'ProRes 4444, from the desktop tools' },
  { name: 'WebM', what: 'VP9, with alpha' },
  { name: 'GIF', what: 'Animated image' },
  { name: 'PNG', what: 'A still or every frame, up to 16 bits' },
  { name: 'Lottie', what: 'Vectors for web and apps' },
  { name: 'SVG', what: 'A frame as vectors' },
  { name: 'WAV', what: 'The sound mix alone' },
];
