const mediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const maxDimension = 2048;
const maxImageBytes = 4 * 1024 * 1024;
// DSH has accepted both a pixel/byte policy and a dimension/hard-byte target
// at this same attachment seam. Each resolves only the fields it owns.
export const requestImageTarget = Object.freeze({
  width: maxDimension, height: maxDimension, maxImageBytes, imageTargetBytes: maxImageBytes,
  maxPixels: maxDimension ** 2, maxBytes: maxImageBytes,
});
const maxInlineImageBytes = 64 * 1024 * 1024;

export function createImageInputs(attachments, signal) {
  let encodedBytes = 0;
  return async ({ attachment }) => {
    signal?.throwIfAborted();
    if (typeof attachments?.readImageRequest !== 'function') {
      throw Object.assign(new Error('当前 DSH 环境无法读取图片附件。'), { code: 'UNSUPPORTED_CONTENT' });
    }
    let image;
    try {
      image = await attachments.readImageRequest(attachment, requestImageTarget, signal);
    } catch {
      signal?.throwIfAborted();
      throw Object.assign(new Error('无法读取图片附件，请重新添加后再试。'), { code: 'ATTACHMENT_READ_FAILED' });
    }
    signal?.throwIfAborted();
    if (!mediaTypes.has(image?.mediaType) || !(image.data instanceof Uint8Array) || image.data.byteLength === 0) {
      throw Object.assign(new Error('图片格式无效或当前模型不支持该格式。'), { code: 'UNSUPPORTED_CONTENT' });
    }
    const prefix = `data:${image.mediaType};base64,`;
    const nextBytes = encodedBytes + prefix.length + 4 * Math.ceil(image.data.byteLength / 3);
    // The DSH rendition's encoded-byte target is soft. Check the actual bytes.
    if (image.data.byteLength > maxImageBytes || nextBytes > maxInlineImageBytes) {
      throw Object.assign(new Error('图片附件超出当前请求大小，请缩小图片或新建会话。'), { code: 'ATTACHMENT_TOO_LARGE' });
    }
    encodedBytes = nextBytes;
    const { buffer, byteOffset, byteLength } = image.data;
    return {
      type: 'input_image',
      image_url: prefix + Buffer.from(buffer, byteOffset, byteLength).toString('base64'),
      detail: 'auto',
    };
  };
}
