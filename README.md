# funai-sdk

The FunAI SDK is a developer-friendly toolkit designed to simplify interactions with the FunAI Infer Chain, ensuring seamless integration and efficient AI task execution. It bases on funai.js.

Key Features of FunAI SDK
	•	Task Management: Provides APIs to submit, query, and manage AI tasks on the FunAI Infer Chain. Developers can easily deploy AI computations and monitor execution progress.
	•	Data Processing: Supports preprocessing and postprocessing of data, including format conversion and data cleaning, ensuring compatibility with the FunAI Infer Chain.
	•	Result Retrieval: Enables fetching results from the FunAI Infer Chain, ensuring accuracy and integrity of AI task outputs.

How FunAI SDK Interacts with the FunAI Infer Chain
	1.	Task Submission: Developers use the FunAI SDK to package and submit AI tasks to the FunAI Infer Chain. The SDK handles transaction creation and ensures the task is properly formatted for blockchain processing.
	2.	Status Monitoring: The SDK provides APIs to track task execution status on-chain, checking whether tasks are accepted, in progress, or completed.
	3.	Result Retrieval: Once a task is completed, developers can retrieve and decode the results using the SDK, ensuring seamless integration with their applications.
	4.	Error Handling: If errors occur during execution, the FunAI SDK captures relevant details, providing debugging tools to help developers diagnose and resolve issues.

By leveraging the FunAI SDK, developers can interact with the FunAI Infer Chain efficiently, focusing on AI-driven applications without delving into blockchain complexities.

## Packages

For installation instructions and usage guidelines, refer to the respective `README` in each package directory.

### Connecting Wallets

- [`@funai/connect`] Connect web application to FunAI wallet browser extensions _(separate repo)_.

### FunAI Primitives

- [`@funai/transactions`] Construct, decode transactions, and work with Clarity smart contracts on the FunAI blockchain.
- [`@funai/wallet-sdk`] Library for building wallets, managing accounts, and handling keys for the FunAI blockchain.
- [`@funai/storage`] Store and fetch files with Gaia, the decentralized storage system.
- [`@funai/encryption`] Encryption functions used by funai.js packages.
- [`@funai/auth`] Construct and decode authentication requests for FunAI apps.
- [`@funai/profile`] Functions for manipulating user profiles.
- [`@funai/network`] Network and API library for working with FunAI blockchain nodes.
- [`@funai/common`] Common utilities used by funai.js packages.


- [`@funai/bns`] Library for interacting with the BNS contract.
- [`@funai/stacking`] Library for PoX stacking.


## License

FunAI.js is open source and released under the MIT License.
