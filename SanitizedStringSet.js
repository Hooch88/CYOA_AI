class SanitizedStringSet extends Set {
  // Adds items after trimming, replacing punctuation with spaces, collapsing spaces, and converting to lowercase
  static #sanitizeValue(value) {
    if (typeof value !== 'string') {
      throw new TypeError('SanitizedStringSet only accepts string values.');
    }
    return value
      .replace(/[^\w\s]|_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  add(value) {
    if (typeof value === 'string') {
      const sanitized = SanitizedStringSet.#sanitizeValue(value);
      super.add(sanitized);
    }
  }
  has(value) {
    if (typeof value === 'string') {
      const sanitized = SanitizedStringSet.#sanitizeValue(value);
      return super.has(sanitized);
    }
    return false;
  }
  delete(value) {
    if (typeof value === 'string') {
      const sanitized = SanitizedStringSet.#sanitizeValue(value);
      return super.delete(sanitized);
    }
    return false;
  }
}

module.exports = SanitizedStringSet;