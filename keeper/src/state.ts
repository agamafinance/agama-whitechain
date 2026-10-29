// Where each scan stopped, so a tick only reads the blocks it has not seen.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { STATE_FILE, W, E } from './config';

type State = { wcBlock: number; ethBlock: number };

export function load(): State {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  return { wcBlock: W.deployedAtBlock, ethBlock: E.deployedAtBlock };
}

export function save(s: State) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
