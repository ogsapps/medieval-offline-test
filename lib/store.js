'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * A tiny, dependency-free JSON store. Writes are atomic: the scribe writes to
 * a temporary scroll, then renames it into place so a crash never tears a page.
 */
class JsonStore {
  constructor(filePath, fallback) {
    this.filePath = filePath;
    this.fallback = fallback;
  }

  async read() {
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return this.fallback;
      if (err instanceof SyntaxError) {
        // A corrupted scroll is preserved for the archivist, then replaced.
        const backup = `${this.filePath}.corrupt-${Date.now()}`;
        try {
          await fsp.rename(this.filePath, backup);
        } catch {
          /* the archivist is unavailable */
        }
        return this.fallback;
      }
      throw err;
    }
  }

  async write(value) {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, this.filePath);
  }
}

module.exports = { JsonStore };