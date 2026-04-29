/**
 * src/encoding/Codec.js
 * Simulates encoding and decoding for each FEC scheme.
 * In a real implementation these would be actual codec algorithms.
 * Here we model their statistical error-correction behaviour.
 */

const { ENCODING_SCHEMES } = require('../../config/defaults');

/**
 * Encode a packet using the selected scheme.
 * Returns { encoded, overhead, redundancyBits, codecInfo }
 */
function encodePacket(packet, scheme) {
  const enc = ENCODING_SCHEMES[scheme] || ENCODING_SCHEMES.none;
  const inputBits    = packet.size * 8;
  const redundancy   = Math.ceil(inputBits * enc.overhead);
  const encodedBits  = inputBits + redundancy;
  const encodedBytes = Math.ceil(encodedBits / 8);

  const codecInfo = buildCodecInfo(scheme, inputBits, redundancy);

  return {
    encoded:       true,
    scheme,
    originalSize:  packet.size,
    encodedSize:   encodedBytes,
    overhead:      enc.overhead,
    redundancyBits: redundancy,
    corrBits:      enc.corrBits,
    codeRate:      inputBits / encodedBits,
    codecInfo,
  };
}

/**
 * Attempt to decode/correct errors in a received packet.
 * Returns { success, corrected, uncorrectable, errorBits }
 */
function decodePacket(encodedPacket, bitErrors, scheme) {
  const enc = ENCODING_SCHEMES[scheme] || ENCODING_SCHEMES.none;

  if (bitErrors === 0) {
    return { success: true, corrected: false, uncorrectable: false, errorBits: 0 };
  }

  if (enc.corrBits === 0) {
    // Detection only (e.g. CRC) — detect but cannot correct
    return { success: false, corrected: false, uncorrectable: true, errorBits: bitErrors, detected: true };
  }

  if (bitErrors <= enc.corrBits) {
    // Within correction capability
    return { success: true, corrected: true, uncorrectable: false, errorBits: bitErrors };
  }

  // Beyond correction capability — may still detect
  const detected = bitErrors <= enc.corrBits * 2;
  return { success: false, corrected: false, uncorrectable: true, errorBits: bitErrors, detected };
}

/**
 * Build human-readable codec information for the frame view.
 */
function buildCodecInfo(scheme, inputBits, redundancyBits) {
  switch (scheme) {
    case 'hamming': {
      const r = Math.ceil(Math.log2(inputBits + Math.ceil(Math.log2(inputBits)) + 1));
      return {
        'Type':            'Hamming(n,k)',
        'Parity bits':     r,
        'Detects':         '2-bit errors',
        'Corrects':        '1-bit errors',
        'Parity positions': Array.from({length: r}, (_,i) => Math.pow(2,i)).join(', '),
      };
    }
    case 'crc32':
      return {
        'Type':       'CRC-32',
        'Polynomial': '0x04C11DB7',
        'Checksum-B': 4,
        'Detects':    'burst ≤32 bits',
        'Corrects':   'none (ARQ only)',
      };
    case 'reed-solomon':
      return {
        'Type':        'RS(255,223)',
        'Symbol-bits': 8,
        'Code-words':  255,
        'Data-words':  223,
        'Corrects':    '16 symbol errors',
        'Overhead':    `${redundancyBits} bits`,
      };
    case 'turbo':
      return {
        'Type':         'Turbo Code',
        'Code rate':    '1/3',
        'Constraint':   'K=4',
        'Iterations':   8,
        'Near-Shannon': 'yes',
        'Used in':      '4G LTE, 5G NR',
      };
    case 'ldpc':
      return {
        'Type':          'LDPC',
        'Code rate':     '3/4',
        'Block length':  1944,
        'Density':       'low',
        'Iterations':    50,
        'Used in':       '5G NR, Wi-Fi 6',
      };
    case 'none':
    default:
      return { 'Type': 'None', 'Detection': 'none', 'Correction': 'none' };
  }
}

module.exports = { encodePacket, decodePacket };
