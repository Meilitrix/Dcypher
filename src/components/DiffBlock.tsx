import type { FileDiff } from '@decypher/core';

const SIGN = { added: '+', removed: '-', context: ' ' } as const;

/** Renders one file's unified-style diff with green/red line backgrounds. */
export function DiffBlock({ file }: { file: FileDiff }) {
  return (
    <div className="diff-file">
      <div className="diff-head">
        <span className={`badge ${file.action}`}>{file.action}</span>
        <span className="path">{file.path}</span>
        <span className="counts">
          <span className="add">+{file.added}</span>
          <span className="rem">-{file.removed}</span>
        </span>
      </div>
      <p className="why">{file.whyChanged}</p>
      <div className="diff">
        {file.lines.map((line, i) => (
          <div key={i} className={`line ${line.kind}`}>
            <span className="no">{line.oldLine ?? ''}</span>
            <span className="no">{line.newLine ?? ''}</span>
            <span className="sign">{SIGN[line.kind]}</span>
            <span className="code">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
