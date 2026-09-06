// Source Verification Adapter Pattern for Talent Ledger
// Each adapter implements the ISourceVerificationAdapter interface

/**
 * Base adapter class with common functionality
 */
class BaseAdapter {
  constructor(issuerCode, issuerName, supportedMethods) {
    this.issuerCode = issuerCode;
    this.issuerName = issuerName;
    this.supportedMethods = supportedMethods;
    this._available = true;
    this._lastFailure = null;
    this._failCount = 0;
    this._circuitBreakerThreshold = 5;
    this._circuitBreakerTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async checkAvailability() {
    if (this._failCount >= this._circuitBreakerThreshold) {
      const elapsed = Date.now() - this._lastFailure;
      if (elapsed < this._circuitBreakerTimeout) return false;
      this._failCount = 0; // Reset after timeout
    }
    return this._available;
  }

  _recordFailure() {
    this._failCount++;
    this._lastFailure = Date.now();
  }

  _recordSuccess() {
    this._failCount = 0;
  }
}

// ── 1. NADRA Verisys Adapter ──
export class NadraVerisysAdapter extends BaseAdapter {
  constructor() {
    super('NADRA', 'National Database and Registration Authority', ['API_DIRECT', 'BIOMETRIC_MATCH']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with NADRA Verisys is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

// ── 2. HEC Adapter ──
export class HECAdapter extends BaseAdapter {
  constructor() {
    super('HEC', 'Higher Education Commission', ['API_DIRECT', 'DASHBOARD_CONFIRM']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with Higher Education Commission (HEC) is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

// ── 3-6. BTE Adapters (KP, Punjab, Sindh, Balochistan) ──
class BTEAdapter extends BaseAdapter {
  constructor(province, code, institutionName) {
    super(code, `${province} Board of Technical Education`, ['DASHBOARD_CONFIRM', 'MANUAL_LETTER']);
    this.province = province;
    this.institutionName = institutionName;
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: `Direct API integration with ${this.institutionName} is pending. Contact the institution to verify this credential manually.`,
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

export class KPBTEAdapter extends BTEAdapter {
  constructor() { super('Khyber Pakhtunkhwa', 'KP_BTE', 'Board of Technical Education KP (BTE-KP)'); }
}

export class PunjabBTEAdapter extends BTEAdapter {
  constructor() { super('Punjab', 'PUNJAB_BTE', 'Board of Technical Education Punjab (BTE-Punjab)'); }
}

export class SindhBTEAdapter extends BTEAdapter {
  constructor() { super('Sindh', 'SINDH_BTE', 'Board of Technical Education Sindh (BTE-Sindh)'); }
}

export class BalochistanBTEAdapter extends BTEAdapter {
  constructor() { super('Balochistan', 'BALOCHISTAN_BTE', 'Board of Technical Education Balochistan (BTE-Balochistan)'); }
}

// ── 7. NAVTTC Adapter ──
export class NAVTTCAdapter extends BaseAdapter {
  constructor() {
    super('NAVTTC', 'National Vocational & Technical Training Commission', ['DASHBOARD_CONFIRM', 'MANUAL_LETTER']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with NAVTTC is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

// ── 8. TTB Adapter ──
export class TTBAdapter extends BaseAdapter {
  constructor() {
    super('TTB', 'Trade Testing Board', ['DASHBOARD_CONFIRM', 'MANUAL_LETTER']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with Trade Testing Board (TTB) is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

// ── 9. Professional Body Adapters ──
export class PECAdapter extends BaseAdapter {
  constructor() {
    super('PEC', 'Pakistan Engineering Council', ['API_DIRECT', 'DASHBOARD_CONFIRM']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with Pakistan Engineering Council (PEC) is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

export class PMDCAdapter extends BaseAdapter {
  constructor() {
    super('PMDC', 'Pakistan Medical & Dental Council', ['API_DIRECT']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with Pakistan Medical & Dental Council (PMDC) is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

export class ICAPAdapter extends BaseAdapter {
  constructor() {
    super('ICAP', 'Institute of Chartered Accountants of Pakistan', ['API_DIRECT']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with Institute of Chartered Accountants of Pakistan (ICAP) is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

// ── 10. BEOE Adapter ──
export class BEOEAdapter extends BaseAdapter {
  constructor() {
    super('BEOE', 'Bureau of Emigration & Overseas Employment', ['API_DIRECT']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with Bureau of Emigration & Overseas Employment (BEOE) is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

// ── 11. GAMCA Adapter ──
export class GAMCAAdapter extends BaseAdapter {
  constructor() {
    super('GAMCA', 'Gulf Approved Medical Centres Association', ['API_DIRECT']);
  }

  async verifyCredential(request) {
    return {
      verified: false,
      pending: true,
      reason: 'Direct API integration with GCC Approved Medical Centers Association (GAMCA) is pending. Contact the institution to verify this credential manually.',
      adapter: this.constructor.name,
      mock: false,
    };
  }
}

// ── 12. Open Badges Verifier ──
export class OpenBadgesAdapter extends BaseAdapter {
  constructor() {
    super('OPEN_BADGES', 'Open Badges 3.0 Verifier', ['API_DIRECT']);
  }

  async verifyCredential(request) {
    try {
      if (request.badgeUrl) {
        const res = await fetch(request.badgeUrl);
        if (!res.ok) throw new Error('Badge fetch failed');
        const badge = await res.json();
        return {
          verified: !!badge.id,
          source: 'OPEN_BADGES',
          badgeValid: !!badge.id,
          issuerVerified: !!badge.issuer,
          badgeDetails: { name: badge.name, issuer: badge.issuer?.name },
          verifiedAt: new Date().toISOString(),
        };
      }
      return { verified: false, source: 'OPEN_BADGES', error: 'No badge URL provided' };
    } catch (err) {
      this._recordFailure();
      return { verified: false, source: 'OPEN_BADGES', error: err.message };
    }
  }
}

// ── 13. Manual Verification Adapter (Universal Fallback) ──
export class ManualVerificationAdapter extends BaseAdapter {
  constructor() {
    super('MANUAL', 'Manual Verification', ['MANUAL_LETTER']);
  }

  async verifyCredential(request) {
    // Creates a verification request ticket for manual processing
    return {
      verified: false,
      source: 'MANUAL',
      ticketCreated: true,
      ticketId: `MV-${Date.now()}`,
      status: 'PENDING_MANUAL_REVIEW',
      instructions: 'Verification request has been queued for manual processing. An officer will review and update the status.',
      verifiedAt: null,
    };
  }
}

// ── Adapter Factory ──
const adapters = {
  NADRA: new NadraVerisysAdapter(),
  HEC: new HECAdapter(),
  KP_BTE: new KPBTEAdapter(),
  PUNJAB_BTE: new PunjabBTEAdapter(),
  SINDH_BTE: new SindhBTEAdapter(),
  BALOCHISTAN_BTE: new BalochistanBTEAdapter(),
  NAVTTC: new NAVTTCAdapter(),
  TTB: new TTBAdapter(),
  PEC: new PECAdapter(),
  PMDC: new PMDCAdapter(),
  ICAP: new ICAPAdapter(),
  BEOE: new BEOEAdapter(),
  GAMCA: new GAMCAAdapter(),
  OPEN_BADGES: new OpenBadgesAdapter(),
  MANUAL: new ManualVerificationAdapter(),
};

export function getAdapter(issuerCode) {
  return adapters[issuerCode] || adapters.MANUAL;
}

export function getAllAdapters() {
  return Object.entries(adapters).map(([code, adapter]) => ({
    code,
    name: adapter.issuerName,
    methods: adapter.supportedMethods,
  }));
}

export default { getAdapter, getAllAdapters };
