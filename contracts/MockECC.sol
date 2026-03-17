// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

/**
 * @title MockECC
 * @notice Full ERC20Votes mock — required by GovernorVotes for governance tests
 */
contract MockECC is ERC20, ERC20Votes {

    constructor() ERC20("EcoCoin", "ECC") ERC20Permit("EcoCoin") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // ERC20Votes overrides
    function _afterTokenTransfer(address from, address to, uint256 amount)
        internal override(ERC20, ERC20Votes)
    {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount)
        internal override(ERC20, ERC20Votes)
    {
        super._mint(to, amount);
    }

    function _burn(address from, uint256 amount)
        internal override(ERC20, ERC20Votes)
    {
        super._burn(from, amount);
    }
}

/**
 * @title MockECCSimple
 * @notice Lightweight mock WITHOUT voting — kept for backwards compatibility
 */
contract MockECCSimple is ERC20 {

    constructor() ERC20("EcoCoin", "ECC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function delegate(address) external pure {}

    function getVotes(address account) external view returns (uint256) {
        return balanceOf(account);
    }
}
