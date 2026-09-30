// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@uma/core/contracts/optimistic-oracle-v3/interfaces/OptimisticOracleV3Interface.sol";

interface IOptimisticOracleV3 is OptimisticOracleV3Interface {

    function defaultCurrency() external view returns (address);

    function defaultLiveness() external view returns (uint64);

    function stampAssertion(bytes32 assertionId) external view returns (bytes memory);
}