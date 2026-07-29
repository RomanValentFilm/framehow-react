// Registers DM Sans with a jsPDF document.
//
// Without this, jsPDF falls back to its built-in Helvetica, which can only
// encode Windows-1252 — so Czech/Slovak/Polish letters are silently dropped and
// leave a gap. Embedding the font also makes exported PDFs match the app, which
// uses DM Sans on screen and for the WRITE tool.

import { DM_SANS_REGULAR_B64, DM_SANS_BOLD_B64 } from '../assets/fonts/dmSansBase64';

export const PDF_FONT = 'DMSans';

/** Install DM Sans into a jsPDF instance and make it the active font. */
export function registerPdfFont(pdf: any): void {
  try {
    pdf.addFileToVFS('DMSans-Regular.ttf', DM_SANS_REGULAR_B64);
    pdf.addFont('DMSans-Regular.ttf', PDF_FONT, 'normal');
    pdf.addFileToVFS('DMSans-Bold.ttf', DM_SANS_BOLD_B64);
    pdf.addFont('DMSans-Bold.ttf', PDF_FONT, 'bold');
    pdf.setFont(PDF_FONT, 'normal');
  } catch {
    // If anything goes wrong, leave jsPDF on Helvetica rather than fail the export
  }
}
