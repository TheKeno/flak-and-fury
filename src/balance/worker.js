// A Balance Lab Web Worker: gets the data files once, then runs one match per message with the shared
// runner (the CLI's worker threads run the same code). Messages in: { content } then { job }.
// Out: { progress, index } now and then, { result, index } when a match is done, { error, index }.
import { runMatch } from './runner.js';

let content = null;

self.onmessage = ({ data }) => {
  if (data.content) {
    content = data.content;
    return;
  }
  const { job } = data;
  try {
    let last = 0;
    const result = runMatch(content, {
      ...job,
      onProgress: (share) => {
        if (share - last < 0.05) return;
        last = share;
        self.postMessage({ progress: share, index: job.index });
      },
    });
    self.postMessage({ result, index: job.index });
  } catch (e) {
    self.postMessage({ error: String(e?.stack ?? e), index: job.index });
  }
};
