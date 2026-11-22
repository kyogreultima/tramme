// What the gallery takes: each file of a published film (the video, its still,
// the project's archive) at most this size. The Worker refuses more; the
// editor checks first, and publishes a film without its archive when only the
// archive is too large.

export const GALLERY_FILE_LIMIT = 60 * 1024 * 1024;
