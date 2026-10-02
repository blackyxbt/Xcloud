// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NoBreachVault
/// @notice Holds project payments and lets its owner withdraw ETH and ERC-20 tokens.
/// @dev This contract intentionally has no upgrade, arbitrary-call, or user-balance logic.
contract NoBreachVault {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event NativeWithdrawn(address indexed to, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    error Unauthorized();
    error InvalidAddress();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function withdrawNative(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit NativeWithdrawn(to, amount);
    }

    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0) || to == address(0)) revert InvalidAddress();
        (bool success, bytes memory result) = token.call(
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount)
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TransferFailed();
        }
        emit TokenWithdrawn(token, to, amount);
    }
}
