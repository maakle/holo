const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

/**
 * LangChain-style recursive character splitter.
 * Counts code points via Array.from (handles surrogate pairs correctly).
 */
export function recursiveSplit(
  text: string,
  opts: { chunkSize: number; overlap: number; separators?: string[] },
): string[] {
  const { chunkSize, overlap, separators = DEFAULT_SEPARATORS } = opts;

  if (text === '') return [];

  const codePoints = Array.from(text);
  if (codePoints.length <= chunkSize) return [text];

  // Find the highest-priority separator that appears in the text
  let chosenSep = '';
  let sepIndex = separators.length - 1; // default to last (empty string)
  for (let i = 0; i < separators.length; i++) {
    const sep = separators[i];
    if (sep === undefined) continue;
    if (sep === '' || text.includes(sep)) {
      chosenSep = sep;
      sepIndex = i;
      break;
    }
  }

  const nextSeparators = separators.slice(sepIndex + 1);

  // Split text on chosen separator
  let pieces: string[];
  if (chosenSep === '') {
    // Split into individual code points
    pieces = Array.from(text);
  } else {
    pieces = text.split(chosenSep);
  }

  // Expand each piece: if it exceeds chunkSize, recurse with finer separator
  const expandedPieces: string[] = [];
  for (const piece of pieces) {
    if (Array.from(piece).length > chunkSize) {
      const sub = recursiveSplit(piece, {
        chunkSize,
        overlap,
        separators: nextSeparators.length > 0 ? nextSeparators : [''],
      });
      expandedPieces.push(...sub);
    } else {
      expandedPieces.push(piece);
    }
  }

  // Greedily pack expanded pieces with separator between them
  const goodChunks: string[] = [];
  let currentPieces: string[] = [];
  let currentLen = 0;
  const sep = chosenSep;

  function flush(): void {
    if (currentPieces.length === 0) return;
    goodChunks.push(currentPieces.join(sep));
    currentPieces = [];
    currentLen = 0;
  }

  for (const piece of expandedPieces) {
    const pieceLen = Array.from(piece).length;
    const sepLen = currentPieces.length > 0 ? Array.from(sep).length : 0;
    const wouldBe = currentLen + sepLen + pieceLen;

    if (wouldBe > chunkSize && currentPieces.length > 0) {
      flush();
    }

    currentPieces.push(piece);
    currentLen = Array.from(currentPieces.join(sep)).length;
  }
  flush();

  if (overlap === 0 || goodChunks.length <= 1) {
    return goodChunks;
  }

  // Apply overlap: prepend last `overlap` code points of chunk N onto chunk N+1,
  // snapped back to the nearest separator boundary within the overlap window.
  const result: string[] = [];
  const first = goodChunks[0];
  if (first !== undefined) result.push(first);

  for (let i = 1; i < goodChunks.length; i++) {
    const prev = goodChunks[i - 1];
    const curr = goodChunks[i];
    if (prev === undefined || curr === undefined) continue;

    const prevCp = Array.from(prev);
    const overlapWindow = prevCp.slice(Math.max(0, prevCp.length - overlap));
    const overlapStr = overlapWindow.join('');

    // Find the last separator within the overlap window to snap back to
    let prefix = overlapStr;
    for (const s of separators) {
      if (s === undefined || s === '') continue;
      const idx = overlapStr.lastIndexOf(s);
      if (idx !== -1) {
        prefix = overlapStr.slice(idx + s.length);
        break;
      }
    }

    result.push(prefix + curr);
  }

  return result;
}
