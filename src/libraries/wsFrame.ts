export type WsDirection = "client" | "server";

// Decodes a single WebSocket text frame (opcode 0x1). Returns null for
// non-text frames, control frames, or buffers too short to hold the header.
// Binary payloads are intentionally skipped since this is used for logging.
export const decodeWsTextFrame = (buffer: Buffer): string | null => {
    if (buffer.length < 2) {
        return null;
    }
    const opcode = buffer[0] & 0x0f;
    if (opcode !== 0x1) {
        return null;
    }
    const isMasked = (buffer[1] & 0x80) !== 0;
    let payloadStart = 2;
    let payloadLength = buffer[1] & 0x7f;
    if (payloadLength === 126) {
        if (buffer.length < 4) {
            return null;
        }
        payloadLength = buffer.readUInt16BE(2);
        payloadStart = 4;
    } else if (payloadLength === 127) {
        if (buffer.length < 10) {
            return null;
        }
        payloadLength = buffer.readUInt32BE(6);
        payloadStart = 10;
    }
    if (!isMasked) {
        return buffer.subarray(payloadStart, payloadStart + payloadLength).toString("utf8");
    }
    if (buffer.length < payloadStart + 4) {
        return null;
    }
    const maskKey = buffer.subarray(payloadStart, payloadStart + 4);
    payloadStart += 4;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLength));
    for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
    }
    return payload.toString("utf8");
};
