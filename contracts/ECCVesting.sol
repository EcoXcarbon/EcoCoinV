// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ECCVesting
 * @notice Token vesting for team, advisors, investors and partners.
 *
 * Schedule types:
 *   LINEAR   — tokens released continuously from start to end
 *   CLIFF    — nothing until cliff, then full amount unlocked
 *   STEPPED  — equal tranches released at fixed intervals
 *
 * Features:
 *   - Multi-beneficiary support
 *   - Revocable schedules (admin can claw back unvested tokens)
 *   - Emergency pause
 *   - On-chain vesting calculator (vestedAmount, claimable)
 */
contract ECCVesting is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ── Roles ──────────────────────────────────────────────────────────────
    bytes32 public constant VESTING_ADMIN_ROLE = keccak256("VESTING_ADMIN_ROLE");

    // ── Schedule types ─────────────────────────────────────────────────────
    enum VestingType { LINEAR, CLIFF, STEPPED }

    // ── Vesting schedule ───────────────────────────────────────────────────
    struct Schedule {
        address beneficiary;
        uint256 totalAmount;       // total tokens to vest
        uint256 claimedAmount;     // already claimed
        uint64  startTime;         // vesting start (unix)
        uint64  cliffDuration;     // seconds before any tokens vest
        uint64  vestingDuration;   // total seconds of vesting
        uint32  steps;             // for STEPPED: number of equal tranches
        VestingType vestingType;
        bool    revocable;
        bool    revoked;
        string  label;             // e.g. "Team", "Seed Round", "Advisor"
    }

    // ── State ──────────────────────────────────────────────────────────────
    IERC20 public immutable token;
    uint256 public nextScheduleId;
    mapping(uint256 => Schedule) public schedules;
    mapping(address => uint256[]) public beneficiarySchedules;

    // ── Events ─────────────────────────────────────────────────────────────
    event ScheduleCreated(uint256 indexed id, address indexed beneficiary, uint256 totalAmount, string label);
    event TokensClaimed(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event ScheduleRevoked(uint256 indexed id, address indexed beneficiary, uint256 unvestedReturned);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    // ── Constructor ────────────────────────────────────────────────────────
    constructor(address _token) {
        require(_token != address(0), "Zero token address");
        token = IERC20(_token);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VESTING_ADMIN_ROLE, msg.sender);
    }

    // ── Admin: create schedule ─────────────────────────────────────────────
    function createSchedule(
        address         beneficiary,
        uint256         totalAmount,
        uint64          startTime,
        uint64          cliffDuration,
        uint64          vestingDuration,
        uint32          steps,
        VestingType     vestingType,
        bool            revocable,
        string calldata label
    ) external onlyRole(VESTING_ADMIN_ROLE) returns (uint256 id) {
        require(beneficiary != address(0),  "Zero beneficiary");
        require(totalAmount  > 0,           "Zero amount");
        require(vestingDuration > 0,        "Zero duration");
        require(vestingType != VestingType.STEPPED || steps > 0, "Steps must be > 0");
        require(cliffDuration <= vestingDuration, "Cliff > duration");

        // CEI: write state before external transfer
        id = nextScheduleId++;
        schedules[id] = Schedule({
            beneficiary:     beneficiary,
            totalAmount:     totalAmount,
            claimedAmount:   0,
            startTime:       startTime == 0 ? uint64(block.timestamp) : startTime,
            cliffDuration:   cliffDuration,
            vestingDuration: vestingDuration,
            steps:           steps,
            vestingType:     vestingType,
            revocable:       revocable,
            revoked:         false,
            label:           label
        });
        beneficiarySchedules[beneficiary].push(id);

        // Pull tokens after all state is written
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        emit ScheduleCreated(id, beneficiary, totalAmount, label);
    }

    // ── Beneficiary: claim vested tokens ──────────────────────────────────
    function claim(uint256 scheduleId) external nonReentrant whenNotPaused {
        Schedule storage s = schedules[scheduleId];
        require(msg.sender == s.beneficiary, "Not beneficiary");
        require(!s.revoked, "Schedule revoked");

        uint256 claimable = _claimable(s);
        require(claimable > 0, "Nothing to claim");

        s.claimedAmount += claimable;
        token.safeTransfer(s.beneficiary, claimable);

        emit TokensClaimed(scheduleId, s.beneficiary, claimable);
    }

    // ── Claim all schedules for sender ─────────────────────────────────────
    function claimAll() external nonReentrant whenNotPaused {
        uint256[] storage ids = beneficiarySchedules[msg.sender];
        for (uint256 i = 0; i < ids.length; i++) {
            Schedule storage s = schedules[ids[i]];
            if (s.revoked) continue;
            uint256 claimable = _claimable(s);
            if (claimable == 0) continue;
            s.claimedAmount += claimable;
            token.safeTransfer(s.beneficiary, claimable);
            emit TokensClaimed(ids[i], s.beneficiary, claimable);
        }
    }

    // ── Admin: revoke schedule ─────────────────────────────────────────────
    function revoke(uint256 scheduleId) external onlyRole(VESTING_ADMIN_ROLE) nonReentrant {
        Schedule storage s = schedules[scheduleId];
        require(s.revocable, "Not revocable");
        require(!s.revoked,  "Already revoked");

        uint256 vested    = _vestedAmount(s);
        uint256 claimable = vested > s.claimedAmount ? vested - s.claimedAmount : 0;
        uint256 unvested  = s.totalAmount - vested;

        s.revoked = true;

        // Pay out vested-but-unclaimed tokens to beneficiary before revoking
        if (claimable > 0) {
            s.claimedAmount += claimable;
            token.safeTransfer(s.beneficiary, claimable);
            emit TokensClaimed(scheduleId, s.beneficiary, claimable);
        }

        // Return unvested tokens to admin
        if (unvested > 0) {
            token.safeTransfer(msg.sender, unvested);
        }

        emit ScheduleRevoked(scheduleId, s.beneficiary, unvested);
    }

    // ── Admin: emergency withdraw ──────────────────────────────────────────
    function emergencyWithdraw(address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(to != address(0), "Zero address");
        token.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount);
    }

    // ── Admin: pause/unpause ───────────────────────────────────────────────
    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Views ──────────────────────────────────────────────────────────────
    function vestedAmount(uint256 scheduleId) external view returns (uint256) {
        return _vestedAmount(schedules[scheduleId]);
    }

    function claimableAmount(uint256 scheduleId) external view returns (uint256) {
        return _claimable(schedules[scheduleId]);
    }

    function getSchedulesByBeneficiary(address beneficiary)
        external view returns (uint256[] memory)
    {
        return beneficiarySchedules[beneficiary];
    }

    function getSchedule(uint256 scheduleId)
        external view returns (Schedule memory)
    {
        return schedules[scheduleId];
    }

    // ── Internal: claimable = vested - already claimed ─────────────────────
    function _claimable(Schedule storage s) internal view returns (uint256) {
        uint256 vested = _vestedAmount(s);
        return vested > s.claimedAmount ? vested - s.claimedAmount : 0;
    }

    // ── Internal: vested amount calculator ────────────────────────────────
    function _vestedAmount(Schedule storage s) internal view returns (uint256) {
        if (s.revoked) return s.claimedAmount; // freeze at claimed

        uint256 cliffEnd = uint256(s.startTime) + uint256(s.cliffDuration);
        if (block.timestamp < cliffEnd) return 0;

        uint256 duration = uint256(s.vestingDuration);
        if (duration == 0) return 0;

        uint256 elapsed = block.timestamp - uint256(s.startTime);
        if (elapsed >= duration) return s.totalAmount;

        if (s.vestingType == VestingType.LINEAR) {
            // Multiply BEFORE divide to preserve precision
            return (s.totalAmount * elapsed) / duration;
        }

        if (s.vestingType == VestingType.CLIFF) {
            // Cliff already passed (checked above), full amount vested
            return s.totalAmount;
        }

        // ── STEPPED ───────────────────────────────────────────────────────
        uint256 steps = uint256(s.steps);
        if (steps == 0) return 0;

        uint256 cliffDur         = uint256(s.cliffDuration);
        uint256 postCliffDuration = duration - cliffDur;
        if (postCliffDuration == 0) return s.totalAmount;

        uint256 elapsedAfterCliff = elapsed - cliffDur;

        // Multiply before divide to avoid precision loss:
        //   completedSteps = floor(elapsedAfterCliff * steps / postCliffDuration)
        uint256 completedSteps = (elapsedAfterCliff * steps) / postCliffDuration;
        if (completedSteps >= steps) return s.totalAmount;

        // Multiply before divide — correct order
        return (s.totalAmount * completedSteps) / steps;
    }
}
