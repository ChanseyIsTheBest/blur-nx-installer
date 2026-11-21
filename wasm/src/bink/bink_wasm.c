// blur-nx-installer (2026-11-21, the user: the movies re-encoded to H.265 for blur-nx 1.0.1): FFmpeg's Bink video
// decoder in WebAssembly (wasm/bink.mjs, built by wasm/src/bink/build.sh from FFmpeg 4.4, configured with that decoder
// only), for the movies' H.265 re-encode (lib/biks.js). rr6-nx-installer's wasm/src/mpeg1 with Bink's decoder (credit
// rr6-nx-installer and culdcept-nx-installer). Each Bink frame's video data goes in as one packet (the bytes after the
// frame's audio tracks); Bink has no reordering, so each packet gives its picture.
//
//   bink_open(width, height, tag, flags) -> 0 / < 0   tag: the file's first 4 bytes as a little-endian u32 ("BIKi"),
//                                                     which FFmpeg reads the Bink revision from; flags: the header's
//                                                     video flags (offset 36), FFmpeg's extradata
//   bink_decode(data, size) -> 1 a picture / 0 none / < 0
//   bink_picture() -> pointer to width * height * 3 / 2 bytes   the last picture, I420 (Y, then U, then V, no padding)
//   bink_close(); bink_malloc(n); bink_free(p); bink_version()
#include <emscripten/emscripten.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/mem.h>

extern AVCodec ff_bink_decoder;

static AVCodecContext *ctx;
static AVPacket *pkt;
static AVFrame *frame;
static uint8_t *i420;
static int width, height;

EMSCRIPTEN_KEEPALIVE void bink_close(void) {
  if (ctx) avcodec_free_context(&ctx);
  if (pkt) av_packet_free(&pkt);
  if (frame) av_frame_free(&frame);
  free(i420);
  i420 = NULL;
}

EMSCRIPTEN_KEEPALIVE int bink_open(int w, int h, unsigned tag, unsigned flags) {
  bink_close();
  ctx = avcodec_alloc_context3(&ff_bink_decoder);
  if (!ctx) return -1;
  ctx->width = ctx->coded_width = width = w;
  ctx->height = ctx->coded_height = height = h;
  ctx->codec_tag = tag;
  ctx->thread_count = 1;
  ctx->extradata = av_mallocz(4 + AV_INPUT_BUFFER_PADDING_SIZE);
  if (!ctx->extradata) return -2;
  ctx->extradata[0] = (uint8_t)flags;
  ctx->extradata[1] = (uint8_t)(flags >> 8);
  ctx->extradata[2] = (uint8_t)(flags >> 16);
  ctx->extradata[3] = (uint8_t)(flags >> 24);
  ctx->extradata_size = 4;
  if (avcodec_open2(ctx, &ff_bink_decoder, NULL) < 0) return -3;
  pkt = av_packet_alloc();
  frame = av_frame_alloc();
  i420 = malloc((size_t)w * h * 3 / 2);
  return pkt && frame && i420 ? 0 : -4;
}

static int take(void) {
  const int err = avcodec_receive_frame(ctx, frame);
  if (err == AVERROR(EAGAIN) || err == AVERROR_EOF) return 0;
  // Bink with alpha decodes as YUVA420P: the first three planes are the picture
  if (err < 0 || (frame->format != AV_PIX_FMT_YUV420P && frame->format != AV_PIX_FMT_YUVA420P)) return -4;
  uint8_t *out = i420;
  for (int k = 0; k < 3; ++k) {
    const int pw = k ? width / 2 : width, ph = k ? height / 2 : height;
    for (int y = 0; y < ph; ++y, out += pw) memcpy(out, frame->data[k] + (size_t)y * frame->linesize[k], pw);
  }
  return 1;
}

// One frame's video data in; its picture out.
EMSCRIPTEN_KEEPALIVE int bink_decode(const uint8_t *data, int size) {
  if (!ctx) return -1;
  if (size <= 0) return 0;
  av_packet_unref(pkt);
  if (av_new_packet(pkt, size) < 0) return -2;
  memcpy(pkt->data, data, size);
  if (avcodec_send_packet(ctx, pkt) < 0) return -3;
  return take();
}

EMSCRIPTEN_KEEPALIVE uint8_t *bink_picture(void) { return i420; }
EMSCRIPTEN_KEEPALIVE void *bink_malloc(int n) { return malloc(n); }
EMSCRIPTEN_KEEPALIVE void bink_free(void *p) { free(p); }
EMSCRIPTEN_KEEPALIVE int bink_version(void) { return LIBAVCODEC_VERSION_INT; }
