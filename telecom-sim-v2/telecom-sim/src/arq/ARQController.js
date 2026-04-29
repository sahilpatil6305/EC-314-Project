/**
 * src/arq/ARQController.js
 * Implements Stop-and-Wait, Go-Back-N, and Selective Repeat ARQ protocols.
 *
 * Stop-and-Wait:   window=1, ACK each frame before sending next
 * Go-Back-N:       window=N, on NACK retransmit from errored frame onward
 * Selective Repeat: window=N, on NACK retransmit only the specific frame
 */

class ARQController {
  constructor(mode, windowSize) {
    this.mode   = mode;
    this.winSize = this._effectiveWindow(mode, windowSize);
    this.reset();
  }

  _effectiveWindow(mode, requested) {
    if (mode === 'stop-wait')  return 1;
    if (mode === 'go-back-n')  return Math.min(requested, 32);
    if (mode === 'selective')  return Math.min(requested, 16);
    return 1;
  }

  reset() {
    this.sendBase  = 0;   // oldest unacked frame
    this.nextSeq   = 0;   // next sequence to send
    this.window    = {};  // seq → { state: 'sent'|'acked'|'nacked', retries }
    this.ackCount  = 0;
    this.nackCount = 0;
    this.retransCount = 0;
    this.windowHistory = new Array(this.winSize * 2).fill('free');
  }

  /**
   * Simulate sending frame with given seq. Returns { lost, retransmit, seq, windowState }
   */
  send(seq, channelLost) {
    const slot = seq % (this.winSize * 2);

    if (channelLost) {
      this.nackCount++;
      this.window[seq] = { state: 'nacked', retries: 0 };
      this.windowHistory[slot] = 'nacked';

      const shouldRetransmit = this._shouldRetransmit(seq);
      if (shouldRetransmit) {
        this.retransCount++;
        this.window[seq] = { state: 'sent', retries: (this.window[seq]?.retries || 0) + 1 };
        this.windowHistory[slot] = 'waiting';
        // Simulate retransmit succeeds after delay
        setTimeout(() => {
          this.ackCount++;
          this.window[seq] = { state: 'acked', retries: this.window[seq]?.retries || 0 };
          this.windowHistory[slot] = 'acked';
          this._slideWindow();
        }, 200);
      }

      return { lost: true, retransmit: shouldRetransmit, seq, windowState: [...this.windowHistory] };
    } else {
      this.ackCount++;
      this.window[seq] = { state: 'acked', retries: 0 };
      this.windowHistory[slot] = 'acked';
      this._slideWindow();
      return { lost: false, retransmit: false, seq, windowState: [...this.windowHistory] };
    }
  }

  _shouldRetransmit(seq) {
    switch (this.mode) {
      case 'stop-wait':
        return true; // Always retransmit immediately
      case 'go-back-n':
        // Retransmit this frame and all subsequent in window
        return true;
      case 'selective':
        // Only retransmit the specific frame
        return true;
      default:
        return true;
    }
  }

  _slideWindow() {
    // Advance sendBase past consecutive acked frames
    while (this.window[this.sendBase]?.state === 'acked') {
      delete this.window[this.sendBase];
      this.sendBase++;
    }
  }

  /**
   * Get the frames that need to be retransmitted based on ARQ mode.
   * Go-Back-N: everything from nacked frame to sendBase+winSize
   * Selective: only the specific frame
   */
  getRetransmitList(nackedSeq) {
    if (this.mode === 'selective') return [nackedSeq];
    if (this.mode === 'go-back-n') {
      const list = [];
      for (let s = nackedSeq; s < this.sendBase + this.winSize; s++) list.push(s);
      return list;
    }
    return [nackedSeq];
  }

  getState() {
    return {
      mode:         this.mode,
      winSize:      this.winSize,
      sendBase:     this.sendBase,
      nextSeq:      this.nextSeq,
      ackCount:     this.ackCount,
      nackCount:    this.nackCount,
      retransCount: this.retransCount,
      windowHistory: this.windowHistory,
      efficiency: this.ackCount > 0
        ? ((this.ackCount / (this.ackCount + this.retransCount)) * 100).toFixed(1) + '%'
        : '100%',
    };
  }
}

module.exports = { ARQController };
