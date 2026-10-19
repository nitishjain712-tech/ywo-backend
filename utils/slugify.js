module.exports = function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")          // remove quotes
    .replace(/&/g, "-and-")        // replace &
    .replace(/[^a-z0-9]+/g, "-")   // replace non-alphanumeric with hyphen
    .replace(/^-+|-+$/g, "");      // remove leading/trailing hyphens
};
