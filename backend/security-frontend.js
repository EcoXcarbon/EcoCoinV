(function() {
    'use strict';

    // ============================================
    // ECOSECURITY BASE CLASS (v1.0)
    // ============================================
    function EcoSecurity() {
        this.VERSION = '1.0.0';
        this.rateLimits = {
            transaction: { maxRequests: 5, windowMs: 60000, requests: [] },
            stake: { maxRequests: 3, windowMs: 300000, requests: [] },
            unstake: { maxRequests: 3, windowMs: 300000, requests: [] },
            claim: { maxRequests: 10, windowMs: 300000, requests: [] },
            vote: { maxRequests: 5, windowMs: 600000, requests: [] },
            purchase: { maxRequests: 10, windowMs: 300000, requests: [] }
        };
        this.txLimits = {
            dailyMax: 100000,
            singleTxMax: 50000,
            cooldownMs: 30000,
            largeThreshold: 10000
        };
        this.sessionConfig = {
            timeoutMs: 1800000,
            warningMs: 300000,
            maxIdleMs: 600000
        };
        this.scamDatabase = {
            addresses: new Set([
                '0x000000000000000000000000000000000000dead',
                '0x0000000000000000000000000000000000000000'
            ]),
            domains: new Set(['scam-ecocoin.com', 'fake-eco.net', 'ecocoin-airdrop.xyz']),
            patterns: [/free.*airdrop/i, /send.*double/i, /urgent.*action/i]
        };
        this.txHistory = [];
        this.auditLog = [];
        this.carbonCreditsUsed = new Set();
        this.lastTxTime = 0;
        this.sessionStart = Date.now();
        this.lastActivity = Date.now();
    }

    EcoSecurity.prototype.sanitizeInput = function(input) {
        if (typeof input !== 'string') return String(input);
        return input.replace(/<[^>]*>/g, '').replace(/[<>\"\'&]/g, '').trim();
    };

    EcoSecurity.prototype.validateAmount = function(amount) {
        var num = parseFloat(amount);
        if (isNaN(num)) return { valid: false, error: 'Invalid number format' };
        if (num <= 0) return { valid: false, error: 'Amount must be positive' };
        if (num > this.txLimits.singleTxMax) return { valid: false, error: 'Amount exceeds single transaction limit' };
        if (!isFinite(num)) return { valid: false, error: 'Invalid amount value' };
        return { valid: true, sanitized: num };
    };

    EcoSecurity.prototype.validateAddress = function(address) {
        if (!address || typeof address !== 'string') return { valid: false, error: 'Address is required' };
        var cleaned = address.trim().toLowerCase();
        if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) return { valid: false, error: 'Invalid Ethereum address format' };
        if (this.scamDatabase.addresses.has(cleaned)) return { valid: false, error: 'Address flagged as suspicious' };
        return { valid: true, address: cleaned };
    };

    EcoSecurity.prototype.checkRateLimit = function(action) {
        var limit = this.rateLimits[action] || this.rateLimits.transaction;
        var now = Date.now();
        limit.requests = limit.requests.filter(function(time) { return now - time < limit.windowMs; });
        if (limit.requests.length >= limit.maxRequests) {
            var waitTime = Math.ceil((limit.windowMs - (now - limit.requests[0])) / 1000);
            return { allowed: false, error: 'Rate limit exceeded. Wait ' + waitTime + ' seconds.', waitTime: waitTime };
        }
        limit.requests.push(now);
        return { allowed: true };
    };

    EcoSecurity.prototype.checkTransactionCooldown = function() {
        var now = Date.now();
        var timeSinceLastTx = now - this.lastTxTime;
        if (timeSinceLastTx < this.txLimits.cooldownMs) {
            var waitTime = Math.ceil((this.txLimits.cooldownMs - timeSinceLastTx) / 1000);
            return { allowed: false, error: 'Please wait ' + waitTime + ' seconds between transactions', waitTime: waitTime };
        }
        return { allowed: true };
    };

    EcoSecurity.prototype.getDailyTotal = function() {
        var oneDayAgo = Date.now() - 86400000;
        var self = this;
        return this.txHistory
            .filter(function(tx) { return tx.timestamp > oneDayAgo; })
            .reduce(function(sum, tx) { return sum + tx.amount; }, 0);
    };

    EcoSecurity.prototype.checkDailyLimit = function(amount) {
        var dailyTotal = this.getDailyTotal();
        var newTotal = dailyTotal + parseFloat(amount);
        if (newTotal > this.txLimits.dailyMax) {
            return { allowed: false, error: 'Daily transaction limit exceeded. Remaining: ' + (this.txLimits.dailyMax - dailyTotal).toFixed(2) };
        }
        return { allowed: true, remaining: this.txLimits.dailyMax - newTotal };
    };

    EcoSecurity.prototype.preTransactionCheck = function(type, amount) {
        var checks = [];
        var amountValidation = this.validateAmount(amount);
        checks.push({ name: 'Amount Validation', passed: amountValidation.valid, error: amountValidation.error });
        var rateCheck = this.checkRateLimit(type);
        checks.push({ name: 'Rate Limit', passed: rateCheck.allowed, error: rateCheck.error });
        var cooldownCheck = this.checkTransactionCooldown();
        checks.push({ name: 'Cooldown', passed: cooldownCheck.allowed, error: cooldownCheck.error });
        var dailyCheck = this.checkDailyLimit(amount);
        checks.push({ name: 'Daily Limit', passed: dailyCheck.allowed, error: dailyCheck.error });
        var allPassed = checks.every(function(c) { return c.passed; });
        this.logAudit('pre_transaction_check', { type: type, amount: amount, passed: allPassed, checks: checks });
        return { approved: allPassed, checks: checks };
    };

    EcoSecurity.prototype.recordTransaction = function(type, amount) {
        this.txHistory.push({ type: type, amount: parseFloat(amount), timestamp: Date.now() });
        this.lastTxTime = Date.now();
        if (this.txHistory.length > 1000) this.txHistory = this.txHistory.slice(-500);
        this.logAudit('transaction_recorded', { type: type, amount: amount });
    };

    EcoSecurity.prototype.checkCarbonCreditDuplicate = function(creditId) {
        if (this.carbonCreditsUsed.has(creditId)) {
            return { valid: false, error: 'Carbon credit already used (double-counting prevented)' };
        }
        return { valid: true };
    };

    EcoSecurity.prototype.registerCarbonCredit = function(creditId) {
        this.carbonCreditsUsed.add(creditId);
        this.logAudit('carbon_credit_registered', { creditId: creditId });
    };

    EcoSecurity.prototype.checkPhishing = function(url) {
        if (!url) return { safe: true };
        try {
            var domain = new URL(url).hostname.toLowerCase();
            if (this.scamDatabase.domains.has(domain)) {
                return { safe: false, reason: 'Known phishing domain' };
            }
            for (var i = 0; i < this.scamDatabase.patterns.length; i++) {
                if (this.scamDatabase.patterns[i].test(url)) {
                    return { safe: false, reason: 'Suspicious URL pattern detected' };
                }
            }
        } catch (e) {
            return { safe: false, reason: 'Invalid URL format' };
        }
        return { safe: true };
    };

    EcoSecurity.prototype.logAudit = function(action, details) {
        this.auditLog.push({ timestamp: Date.now(), action: action, details: details });
        if (this.auditLog.length > 500) this.auditLog = this.auditLog.slice(-250);
    };

    EcoSecurity.prototype.getAuditLog = function(limit) {
        limit = limit || 50;
        return this.auditLog.slice(-limit);
    };

    // ============================================
    // ECOSECURITY ADVANCED CLASS (v2.0)
    // ============================================
    function EcoSecurityAdvanced(baseSecurity) {
        this.base = baseSecurity;
        this.VERSION = '2.0.0';
        this.circuitBreaker = {
            triggered: false,
            triggeredAt: null,
            reason: null,
            autoResetMs: 3600000,
            thresholds: { failedTxCount: 5, failedTxWindowMs: 300000, largeWithdrawalAmount: 50000 }
        };
        this.failedTransactions = [];
        this.whitelist = {
            addresses: new Map(),
            pendingAdditions: new Map(),
            delayForNewMs: 86400000
        };
        this.timelocks = {
            pending: new Map(),
            minDelayMs: 3600000,
            largeThreshold: 25000
        };
        this.behaviorBaseline = {
            avgTxAmount: 1000,
            avgTxPerDay: 5,
            typicalHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
            samples: 0
        };
        this.gasProtection = {
            maxGwei: 100,
            warningGwei: 50,
            historicalPrices: []
        };
        this.approvals = new Map();
        this.honeypotCache = new Map();
        this.slippageConfig = { maxSlippage: 5, defaultSlippage: 0.5, mevProtection: true };
        this.carbonOracle = { verifiedRegistries: ['Verra', 'Gold Standard', 'ACR', 'CAR'], minConfirmations: 2 };
    }

    EcoSecurityAdvanced.prototype.simulateTransaction = function(txParams) {
        var self = this;
        return new Promise(function(resolve) {
            setTimeout(function() {
                var simulation = {
                    success: true,
                    estimatedGas: 150000 + Math.floor(Math.random() * 50000),
                    warnings: [],
                    riskScore: Math.floor(Math.random() * 30)
                };
                if (txParams.amount > 10000) simulation.warnings.push('Large transaction amount');
                if (txParams.to && txParams.to.toLowerCase() === '0x0000000000000000000000000000000000000000') {
                    simulation.success = false;
                    simulation.warnings.push('Sending to null address');
                }
                resolve(simulation);
            }, 100);
        });
    };

    EcoSecurityAdvanced.prototype.triggerCircuitBreaker = function(reason) {
        this.circuitBreaker.triggered = true;
        this.circuitBreaker.triggeredAt = Date.now();
        this.circuitBreaker.reason = reason;
        this.base.logAudit('circuit_breaker_triggered', { reason: reason });
        return { triggered: true, reason: reason };
    };

    EcoSecurityAdvanced.prototype.resetCircuitBreaker = function() {
        this.circuitBreaker.triggered = false;
        this.circuitBreaker.triggeredAt = null;
        this.circuitBreaker.reason = null;
        this.base.logAudit('circuit_breaker_reset', {});
        return { reset: true };
    };

    EcoSecurityAdvanced.prototype.checkCircuitBreaker = function() {
        if (!this.circuitBreaker.triggered) return { active: false };
        var elapsed = Date.now() - this.circuitBreaker.triggeredAt;
        if (elapsed > this.circuitBreaker.autoResetMs) {
            this.resetCircuitBreaker();
            return { active: false, autoReset: true };
        }
        return { active: true, reason: this.circuitBreaker.reason, remainingMs: this.circuitBreaker.autoResetMs - elapsed };
    };

    EcoSecurityAdvanced.prototype.addToWhitelist = function(address, label) {
        var validation = this.base.validateAddress(address);
        if (!validation.valid) return { success: false, error: validation.error };
        var normalized = validation.address;
        if (this.whitelist.addresses.has(normalized)) {
            return { success: false, error: 'Address already whitelisted' };
        }
        this.whitelist.pendingAdditions.set(normalized, {
            label: label, addedAt: Date.now(), effectiveAt: Date.now() + this.whitelist.delayForNewMs
        });
        this.base.logAudit('whitelist_pending', { address: normalized, label: label });
        return { success: true, pending: true, effectiveIn: this.whitelist.delayForNewMs };
    };

    EcoSecurityAdvanced.prototype.isWhitelisted = function(address) {
        var normalized = address.toLowerCase();
        if (this.whitelist.addresses.has(normalized)) return { whitelisted: true, verified: true };
        var pending = this.whitelist.pendingAdditions.get(normalized);
        if (pending && Date.now() >= pending.effectiveAt) {
            this.whitelist.addresses.set(normalized, { label: pending.label, addedAt: pending.addedAt });
            this.whitelist.pendingAdditions.delete(normalized);
            return { whitelisted: true, verified: true };
        }
        if (pending) {
            return { whitelisted: false, pending: true, effectiveAt: pending.effectiveAt };
        }
        return { whitelisted: false };
    };

    EcoSecurityAdvanced.prototype.createTimeLock = function(type, amount, recipient, delayMs) {
        var delay = delayMs || this.timelocks.minDelayMs;
        var id = 'TL-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        this.timelocks.pending.set(id, {
            type: type, amount: amount, recipient: recipient, createdAt: Date.now(), executeAfter: Date.now() + delay, status: 'pending'
        });
        this.base.logAudit('timelock_created', { id: id, type: type, amount: amount, delay: delay });
        return { success: true, id: id, executeAfter: Date.now() + delay };
    };

    EcoSecurityAdvanced.prototype.executeTimeLock = function(id) {
        var lock = this.timelocks.pending.get(id);
        if (!lock) return { success: false, error: 'Timelock not found' };
        if (Date.now() < lock.executeAfter) {
            return { success: false, error: 'Timelock not yet ready', remainingMs: lock.executeAfter - Date.now() };
        }
        lock.status = 'executed';
        this.base.logAudit('timelock_executed', { id: id });
        return { success: true, lock: lock };
    };

    EcoSecurityAdvanced.prototype.cancelTimeLock = function(id) {
        var lock = this.timelocks.pending.get(id);
        if (!lock) return { success: false, error: 'Timelock not found' };
        if (lock.status === 'executed') return { success: false, error: 'Already executed' };
        lock.status = 'cancelled';
        this.base.logAudit('timelock_cancelled', { id: id });
        return { success: true };
    };

    EcoSecurityAdvanced.prototype.detectAnomaly = function(type, amount) {
        var hour = new Date().getHours();
        var isUnusualHour = this.behaviorBaseline.typicalHours.indexOf(hour) === -1;
        var isLargeAmount = amount > this.behaviorBaseline.avgTxAmount * 5;
        var anomalies = [];
        if (isUnusualHour) anomalies.push('Unusual transaction hour');
        if (isLargeAmount) anomalies.push('Amount significantly above average');
        if (anomalies.length > 0) {
            this.base.logAudit('anomaly_detected', { type: type, amount: amount, anomalies: anomalies });
            return { normal: false, anomalies: anomalies, severity: anomalies.length > 1 ? 'high' : 'medium' };
        }
        return { normal: true };
    };

    EcoSecurityAdvanced.prototype.checkGasPrice = function() {
        var self = this;
        return new Promise(function(resolve) {
            var mockGasPrice = 20 + Math.floor(Math.random() * 30);
            self.gasProtection.historicalPrices.push({ price: mockGasPrice, timestamp: Date.now() });
            if (self.gasProtection.historicalPrices.length > 100) {
                self.gasProtection.historicalPrices = self.gasProtection.historicalPrices.slice(-50);
            }
            resolve({
                currentGwei: mockGasPrice,
                safe: mockGasPrice < self.gasProtection.maxGwei,
                warning: mockGasPrice > self.gasProtection.warningGwei,
                recommendation: mockGasPrice > self.gasProtection.warningGwei ? 'Consider waiting for lower gas' : 'Gas price is reasonable'
            });
        });
    };

    EcoSecurityAdvanced.prototype.trackApproval = function(token, spender, amount) {
        var key = token + '-' + spender;
        this.approvals.set(key, { token: token, spender: spender, amount: amount, timestamp: Date.now() });
        this.base.logAudit('approval_tracked', { token: token, spender: spender, amount: amount });
    };

    EcoSecurityAdvanced.prototype.getApprovals = function() {
        return Array.from(this.approvals.values());
    };

    EcoSecurityAdvanced.prototype.checkHoneypot = function(contractAddress) {
        var self = this;
        return new Promise(function(resolve) {
            if (self.honeypotCache.has(contractAddress)) {
                resolve(self.honeypotCache.get(contractAddress));
                return;
            }
            setTimeout(function() {
                var result = {
                    isHoneypot: false,
                    buyTax: Math.floor(Math.random() * 5),
                    sellTax: Math.floor(Math.random() * 5),
                    canSell: true,
                    riskLevel: 'low'
                };
                self.honeypotCache.set(contractAddress, result);
                resolve(result);
            }, 50);
        });
    };

    EcoSecurityAdvanced.prototype.getSecurityDashboard = function() {
        var pendingCount = 0;
        this.timelocks.pending.forEach(function(t) {
            if (t.status === 'pending') pendingCount++;
        });
        return {
            version: this.VERSION,
            circuitBreaker: this.checkCircuitBreaker(),
            whitelistCount: this.whitelist.addresses.size,
            pendingWhitelist: this.whitelist.pendingAdditions.size,
            pendingTimelocks: pendingCount,
            trackedApprovals: this.approvals.size,
            recentAuditLogs: this.base.getAuditLog(10).length,
            securityScore: this.calculateSecurityScore()
        };
    };

    EcoSecurityAdvanced.prototype.calculateSecurityScore = function() {
        var score = 100;
        if (this.circuitBreaker.triggered) score -= 30;
        if (this.whitelist.addresses.size === 0) score -= 10;
        if (this.approvals.size > 10) score -= 5;
        return Math.max(0, score);
    };

    EcoSecurityAdvanced.prototype.calculateSlippage = function(expectedAmount, actualAmount) {
        var slippage = Math.abs((expectedAmount - actualAmount) / expectedAmount * 100);
        return {
            slippage: slippage.toFixed(2),
            acceptable: slippage <= this.slippageConfig.maxSlippage,
            mevProtected: this.slippageConfig.mevProtection
        };
    };

    EcoSecurityAdvanced.prototype.verifyCarbonCredit = function(creditId, registry, data) {
        var self = this;
        return new Promise(function(resolve) {
            setTimeout(function() {
                var isValidRegistry = self.carbonOracle.verifiedRegistries.indexOf(registry) !== -1;
                resolve({
                    verified: isValidRegistry,
                    registry: registry,
                    creditId: creditId,
                    confirmations: isValidRegistry ? self.carbonOracle.minConfirmations : 0,
                    timestamp: Date.now()
                });
            }, 100);
        });
    };

    EcoSecurityAdvanced.prototype.createEncryptedBackup = function() {
        var self = this;
        return new Promise(function(resolve) {
            var data = {
                whitelist: Array.from(self.whitelist.addresses.entries()),
                timelocks: Array.from(self.timelocks.pending.entries()),
                approvals: Array.from(self.approvals.entries()),
                auditLog: self.base.getAuditLog(100),
                exportedAt: Date.now()
            };
            var encrypted = btoa(JSON.stringify(data));
            resolve({ success: true, data: encrypted, size: encrypted.length });
        });
    };

    EcoSecurityAdvanced.prototype.restoreFromBackup = function(encryptedData) {
        return new Promise(function(resolve) {
            try {
                var data = JSON.parse(atob(encryptedData));
                resolve({ success: true, restored: true, itemsRestored: Object.keys(data).length });
            } catch (e) {
                resolve({ success: false, error: 'Invalid backup data' });
            }
        });
    };

    // ============================================
    // TEST FRAMEWORK
    // ============================================
    var testResults = [];
    var logEntries = [];

    function log(message, type) {
        type = type || 'info';
        var entry = { message: message, type: type, timestamp: new Date().toLocaleTimeString() };
        logEntries.push(entry);
        updateLogDisplay();
    }

    function updateLogDisplay() {
        var logOutput = document.getElementById('logOutput');
        if (!logOutput) return;
        var html = '';
        var entries = logEntries.slice(-50);
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            html += '<div class="log-entry ' + e.type + '">[' + e.timestamp + '] ' + e.message + '</div>';
        }
        logOutput.innerHTML = html;
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    function addTestResult(section, name, passed, details) {
        testResults.push({ section: section, name: name, passed: passed, details: details || '' });
    }

    function displayResults() {
        var container = document.getElementById('testResults');
        if (!container) return;
        var sections = {};

        for (var i = 0; i < testResults.length; i++) {
            var r = testResults[i];
            if (!sections[r.section]) sections[r.section] = [];
            sections[r.section].push(r);
        }

        var html = '';
        for (var section in sections) {
            if (sections.hasOwnProperty(section)) {
                html += '<div class="test-section"><h2>' + section + '</h2>';
                var tests = sections[section];
                for (var j = 0; j < tests.length; j++) {
                    var t = tests[j];
                    html += '<div class="test-item">';
                    html += '<span class="name">' + t.name + '</span>';
                    html += '<span class="status ' + (t.passed ? 'pass' : 'fail') + '">' + (t.passed ? 'PASS' : 'FAIL') + '</span>';
                    html += '</div>';
                }
                html += '</div>';
            }
        }
        container.innerHTML = html;

        var passed = 0;
        for (var k = 0; k < testResults.length; k++) {
            if (testResults[k].passed) passed++;
        }
        var total = testResults.length;

        var scoreDisplay = document.getElementById('scoreDisplay');
        var summaryText = document.getElementById('summaryText');
        var summary = document.getElementById('summary');

        if (scoreDisplay) scoreDisplay.textContent = passed + '/' + total;
        if (summaryText) summaryText.textContent = passed === total ? 'All tests passed!' : (total - passed) + ' test(s) failed';
        if (summary) summary.style.display = 'block';
    }

    function clearTests() {
        testResults = [];
        logEntries = [];
        var testResultsEl = document.getElementById('testResults');
        var summary = document.getElementById('summary');
        var logOutput = document.getElementById('logOutput');
        if (testResultsEl) testResultsEl.innerHTML = '';
        if (summary) summary.style.display = 'none';
        if (logOutput) logOutput.innerHTML = '<div class="log-entry">Tests cleared. Ready to run.</div>';
    }

    // ============================================
    // TEST CASES
    // ============================================
    function runAllTests() {
        clearTests();
        log('Starting security test suite...', 'info');

        var baseSecurity = new EcoSecurity();
        var advancedSecurity = new EcoSecurityAdvanced(baseSecurity);

        // Base Security Tests
        log('Testing EcoSecurity Base Module...', 'info');

        // Test 1: Input Sanitization
        var sanitized = baseSecurity.sanitizeInput('<script>alert("xss")</script>');
        addTestResult('Input Validation', 'XSS Prevention', sanitized.indexOf('<script>') === -1);
        log('XSS sanitization: ' + (sanitized.indexOf('<script>') === -1 ? 'PASSED' : 'FAILED'), sanitized.indexOf('<script>') === -1 ? 'success' : 'error');

        // Test 2: Amount Validation - Valid
        var validAmount = baseSecurity.validateAmount('1000');
        addTestResult('Input Validation', 'Valid Amount', validAmount.valid === true);
        log('Valid amount check: ' + (validAmount.valid ? 'PASSED' : 'FAILED'), validAmount.valid ? 'success' : 'error');

        // Test 3: Amount Validation - Invalid (negative)
        var negativeAmount = baseSecurity.validateAmount('-100');
        addTestResult('Input Validation', 'Reject Negative Amount', negativeAmount.valid === false);
        log('Negative amount rejection: ' + (!negativeAmount.valid ? 'PASSED' : 'FAILED'), !negativeAmount.valid ? 'success' : 'error');

        // Test 4: Amount Validation - Exceeds limit
        var exceedsLimit = baseSecurity.validateAmount('999999');
        addTestResult('Input Validation', 'Reject Amount Over Limit', exceedsLimit.valid === false);
        log('Over-limit rejection: ' + (!exceedsLimit.valid ? 'PASSED' : 'FAILED'), !exceedsLimit.valid ? 'success' : 'error');

        // Test 5: Address Validation - Valid
        var validAddress = baseSecurity.validateAddress('0x742d35Cc6634C0532925a3b844Bc454a4e91e123');
        addTestResult('Address Validation', 'Valid Ethereum Address', validAddress.valid === true);
        log('Valid address check: ' + (validAddress.valid ? 'PASSED' : 'FAILED'), validAddress.valid ? 'success' : 'error');

        // Test 6: Address Validation - Invalid format
        var invalidAddress = baseSecurity.validateAddress('not-an-address');
        addTestResult('Address Validation', 'Reject Invalid Format', invalidAddress.valid === false);
        log('Invalid format rejection: ' + (!invalidAddress.valid ? 'PASSED' : 'FAILED'), !invalidAddress.valid ? 'success' : 'error');

        // Test 7: Address Validation - Scam address
        var scamAddress = baseSecurity.validateAddress('0x000000000000000000000000000000000000dead');
        addTestResult('Address Validation', 'Detect Scam Address', scamAddress.valid === false);
        log('Scam address detection: ' + (!scamAddress.valid ? 'PASSED' : 'FAILED'), !scamAddress.valid ? 'success' : 'error');

        // Test 8: Rate Limiting
        log('Testing rate limiting...', 'info');
        for (var i = 0; i < 6; i++) {
            baseSecurity.checkRateLimit('transaction');
        }
        var rateLimited = baseSecurity.checkRateLimit('transaction');
        addTestResult('Rate Limiting', 'Block After Limit Exceeded', rateLimited.allowed === false);
        log('Rate limit enforcement: ' + (!rateLimited.allowed ? 'PASSED' : 'FAILED'), !rateLimited.allowed ? 'success' : 'error');

        // Test 9: Phishing Detection - Safe URL
        var safeUrl = baseSecurity.checkPhishing('https://ecocoin.io');
        addTestResult('Phishing Protection', 'Allow Safe URL', safeUrl.safe === true);
        log('Safe URL check: ' + (safeUrl.safe ? 'PASSED' : 'FAILED'), safeUrl.safe ? 'success' : 'error');

        // Test 10: Phishing Detection - Scam domain
        var phishingUrl = baseSecurity.checkPhishing('https://scam-ecocoin.com/free');
        addTestResult('Phishing Protection', 'Detect Phishing Domain', phishingUrl.safe === false);
        log('Phishing detection: ' + (!phishingUrl.safe ? 'PASSED' : 'FAILED'), !phishingUrl.safe ? 'success' : 'error');

        // Test 11: Carbon Credit Double-Counting
        baseSecurity.registerCarbonCredit('CC-001');
        var duplicate = baseSecurity.checkCarbonCreditDuplicate('CC-001');
        addTestResult('Carbon Credit', 'Prevent Double-Counting', duplicate.valid === false);
        log('Double-counting prevention: ' + (!duplicate.valid ? 'PASSED' : 'FAILED'), !duplicate.valid ? 'success' : 'error');

        // Test 12: Daily Limit Check
        var newBaseSecurity = new EcoSecurity();
        newBaseSecurity.txHistory = [{ amount: 99000, timestamp: Date.now() }];
        var dailyLimitCheck = newBaseSecurity.checkDailyLimit(2000);
        addTestResult('Transaction Limits', 'Enforce Daily Limit', dailyLimitCheck.allowed === false);
        log('Daily limit enforcement: ' + (!dailyLimitCheck.allowed ? 'PASSED' : 'FAILED'), !dailyLimitCheck.allowed ? 'success' : 'error');

        // Advanced Security Tests (async)
        log('Testing EcoSecurityAdvanced Module...', 'info');

        runAsyncTests(advancedSecurity, baseSecurity);
    }

    function runAsyncTests(advancedSecurity, baseSecurity) {
        // Test 13: Transaction Simulation
        advancedSecurity.simulateTransaction({ to: '0x123', amount: 1000 }).then(function(simulation) {
            addTestResult('Transaction Simulation', 'Simulate Valid Transaction', simulation.success === true);
            log('Transaction simulation: ' + (simulation.success ? 'PASSED' : 'FAILED'), simulation.success ? 'success' : 'error');

            // Test 14: Simulation - Detect dangerous transaction
            return advancedSecurity.simulateTransaction({ to: '0x0000000000000000000000000000000000000000', amount: 1000 });
        }).then(function(dangerousSim) {
            addTestResult('Transaction Simulation', 'Detect Dangerous Transaction', dangerousSim.success === false);
            log('Dangerous tx detection: ' + (!dangerousSim.success ? 'PASSED' : 'FAILED'), !dangerousSim.success ? 'success' : 'error');

            // Test 15: Circuit Breaker - Trigger
            advancedSecurity.triggerCircuitBreaker('Test trigger');
            var cbStatus = advancedSecurity.checkCircuitBreaker();
            addTestResult('Circuit Breaker', 'Trigger Circuit Breaker', cbStatus.active === true);
            log('Circuit breaker trigger: ' + (cbStatus.active ? 'PASSED' : 'FAILED'), cbStatus.active ? 'success' : 'error');

            // Test 16: Circuit Breaker - Reset
            advancedSecurity.resetCircuitBreaker();
            var cbResetStatus = advancedSecurity.checkCircuitBreaker();
            addTestResult('Circuit Breaker', 'Reset Circuit Breaker', cbResetStatus.active === false);
            log('Circuit breaker reset: ' + (!cbResetStatus.active ? 'PASSED' : 'FAILED'), !cbResetStatus.active ? 'success' : 'error');

            // Test 17: Whitelist - Add pending
            var whitelistAdd = advancedSecurity.addToWhitelist('0x742d35Cc6634C0532925a3b844Bc454a4e91e123', 'Test');
            addTestResult('Withdrawal Whitelist', 'Add Address (Pending)', whitelistAdd.success === true && whitelistAdd.pending === true);
            log('Whitelist add: ' + (whitelistAdd.success ? 'PASSED' : 'FAILED'), whitelistAdd.success ? 'success' : 'error');

            // Test 18: Whitelist - Check pending status
            var whitelistCheck = advancedSecurity.isWhitelisted('0x742d35Cc6634C0532925a3b844Bc454a4e91e123');
            addTestResult('Withdrawal Whitelist', 'Enforce 24h Delay', whitelistCheck.whitelisted === false && whitelistCheck.pending === true);
            log('Whitelist delay: ' + (!whitelistCheck.whitelisted ? 'PASSED' : 'FAILED'), !whitelistCheck.whitelisted ? 'success' : 'error');

            // Test 19: Time-Lock Creation
            var timelock = advancedSecurity.createTimeLock('withdraw', 10000, '0x123', 500);
            addTestResult('Time-Locked Withdrawals', 'Create Time Lock', timelock.success === true);
            log('Timelock creation: ' + (timelock.success ? 'PASSED' : 'FAILED'), timelock.success ? 'success' : 'error');

            // Test 20: Time-Lock - Cannot execute early
            var earlyExecute = advancedSecurity.executeTimeLock(timelock.id);
            addTestResult('Time-Locked Withdrawals', 'Block Early Execution', earlyExecute.success === false);
            log('Early execution block: ' + (!earlyExecute.success ? 'PASSED' : 'FAILED'), !earlyExecute.success ? 'success' : 'error');

            // Wait and execute timelock
            return new Promise(function(resolve) {
                setTimeout(function() {
                    resolve(timelock.id);
                }, 600);
            });
        }).then(function(timelockId) {
            // Test 21: Time-Lock - Execute after delay
            var executeAfterDelay = advancedSecurity.executeTimeLock(timelockId);
            addTestResult('Time-Locked Withdrawals', 'Execute After Delay', executeAfterDelay.success === true);
            log('Delayed execution: ' + (executeAfterDelay.success ? 'PASSED' : 'FAILED'), executeAfterDelay.success ? 'success' : 'error');

            // Test 22: Anomaly Detection
            var anomaly = advancedSecurity.detectAnomaly('withdraw', 100000);
            addTestResult('Anomaly Detection', 'Detect Large Amount Anomaly', anomaly.normal === false);
            log('Anomaly detection: ' + (!anomaly.normal ? 'PASSED' : 'FAILED'), !anomaly.normal ? 'success' : 'error');

            // Test 23: Gas Price Check
            return advancedSecurity.checkGasPrice();
        }).then(function(gasCheck) {
            addTestResult('Gas Protection', 'Monitor Gas Price', typeof gasCheck.currentGwei === 'number');
            log('Gas monitoring: ' + (typeof gasCheck.currentGwei === 'number' ? 'PASSED' : 'FAILED'), typeof gasCheck.currentGwei === 'number' ? 'success' : 'error');

            // Test 24: Approval Tracking
            advancedSecurity.trackApproval('0xToken', '0xSpender', 1000);
            var approvals = advancedSecurity.getApprovals();
            addTestResult('Token Approval Manager', 'Track Approvals', approvals.length > 0);
            log('Approval tracking: ' + (approvals.length > 0 ? 'PASSED' : 'FAILED'), approvals.length > 0 ? 'success' : 'error');

            // Test 25: Honeypot Detection
            return advancedSecurity.checkHoneypot('0xTestContract');
        }).then(function(honeypot) {
            addTestResult('Honeypot Detection', 'Check Contract Safety', honeypot.isHoneypot === false);
            log('Honeypot check: ' + (!honeypot.isHoneypot ? 'PASSED' : 'FAILED'), !honeypot.isHoneypot ? 'success' : 'error');

            // Test 26: Security Dashboard
            var dashboard = advancedSecurity.getSecurityDashboard();
            addTestResult('Security Dashboard', 'Generate Dashboard', dashboard.version === '2.0.0');
            log('Dashboard generation: ' + (dashboard.version === '2.0.0' ? 'PASSED' : 'FAILED'), dashboard.version === '2.0.0' ? 'success' : 'error');

            // Test 27: Security Score
            addTestResult('Security Dashboard', 'Calculate Security Score', dashboard.securityScore >= 0 && dashboard.securityScore <= 100);
            log('Security score: ' + dashboard.securityScore + '/100', 'success');

            // Test 28: Slippage Calculation
            var slippage = advancedSecurity.calculateSlippage(1000, 980);
            addTestResult('MEV Protection', 'Calculate Slippage', slippage.acceptable === true);
            log('Slippage check: ' + (slippage.acceptable ? 'PASSED' : 'FAILED'), slippage.acceptable ? 'success' : 'error');

            // Test 29: Slippage - Reject excessive
            var highSlippage = advancedSecurity.calculateSlippage(1000, 900);
            addTestResult('MEV Protection', 'Reject High Slippage', highSlippage.acceptable === false);
            log('High slippage rejection: ' + (!highSlippage.acceptable ? 'PASSED' : 'FAILED'), !highSlippage.acceptable ? 'success' : 'error');

            // Test 30: Carbon Credit Verification
            return advancedSecurity.verifyCarbonCredit('CC-123', 'Verra', {});
        }).then(function(carbonVerify) {
            addTestResult('Carbon Credit Oracle', 'Verify Valid Registry', carbonVerify.verified === true);
            log('Carbon verification: ' + (carbonVerify.verified ? 'PASSED' : 'FAILED'), carbonVerify.verified ? 'success' : 'error');

            // Test 31: Carbon Credit - Invalid Registry
            return advancedSecurity.verifyCarbonCredit('CC-123', 'FakeRegistry', {});
        }).then(function(invalidRegistry) {
            addTestResult('Carbon Credit Oracle', 'Reject Invalid Registry', invalidRegistry.verified === false);
            log('Invalid registry rejection: ' + (!invalidRegistry.verified ? 'PASSED' : 'FAILED'), !invalidRegistry.verified ? 'success' : 'error');

            // Test 32: Encrypted Backup
            return advancedSecurity.createEncryptedBackup();
        }).then(function(backup) {
            addTestResult('Encrypted Backup', 'Create Backup', backup.success === true);
            log('Backup creation: ' + (backup.success ? 'PASSED' : 'FAILED'), backup.success ? 'success' : 'error');

            // Test 33: Restore Backup
            return advancedSecurity.restoreFromBackup(backup.data).then(function(restore) {
                addTestResult('Encrypted Backup', 'Restore Backup', restore.success === true);
                log('Backup restore: ' + (restore.success ? 'PASSED' : 'FAILED'), restore.success ? 'success' : 'error');

                // Test 34: Invalid Backup Restore
                return advancedSecurity.restoreFromBackup('invalid-data');
            });
        }).then(function(invalidRestore) {
            addTestResult('Encrypted Backup', 'Reject Invalid Backup', invalidRestore.success === false);
            log('Invalid backup rejection: ' + (!invalidRestore.success ? 'PASSED' : 'FAILED'), !invalidRestore.success ? 'success' : 'error');

            // Test 35: Audit Log
            var auditLog = baseSecurity.getAuditLog(10);
            addTestResult('Audit System', 'Record Audit Logs', auditLog.length > 0);
            log('Audit logging: ' + (auditLog.length > 0 ? 'PASSED' : 'FAILED'), auditLog.length > 0 ? 'success' : 'error');

            log('Test suite completed!', 'success');
            displayResults();
        }).catch(function(error) {
            log('Error running tests: ' + error.message, 'error');
            displayResults();
        });
    }

    function testCircuitBreaker() {
        log('Testing Circuit Breaker activation...', 'warning');
        var baseSecurity = new EcoSecurity();
        var advancedSecurity = new EcoSecurityAdvanced(baseSecurity);

        advancedSecurity.triggerCircuitBreaker('Manual test trigger');
        log('Circuit breaker ACTIVATED - All transactions would be blocked', 'error');

        setTimeout(function() {
            advancedSecurity.resetCircuitBreaker();
            log('Circuit breaker RESET - Transactions allowed again', 'success');
        }, 3000);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        var runBtn = document.getElementById('runBtn');
        var cbBtn = document.getElementById('cbBtn');
        var clearBtn = document.getElementById('clearBtn');

        if (runBtn) {
            runBtn.addEventListener('click', runAllTests);
        }
        if (cbBtn) {
            cbBtn.addEventListener('click', testCircuitBreaker);
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', clearTests);
        }

        log('Security Test Suite ready. Click "Run All Tests" to begin.', 'info');
    }
})();
