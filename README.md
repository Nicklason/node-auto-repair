# node-auto-repair

Automatically detect unhealthy Kubernetes nodes and repair them.

## Inspiration

Google Kubernetes Engine can [automatically repair unhealthy nodes](https://cloud.google.com/kubernetes-engine/docs/how-to/node-auto-repair)
them and then replacing them with a new node. This might not be possible when
running Kubernetes on-premise. Instead of replacing the nodes, an attempt to repair
them can be made by first identifying the problem, and then attempting to repair it.

## Usage

The NodeAutoRepair class listens for unhealthy nodes using the Kubernetes API.
When a node becomes unhealthy, it first waits a given period of time and then
checks if the node is still unhealthy. If it is still unhealthy, then a repair
attempt is made. If the node doesn't become healthy after a given period of
time, then another attempt is made. This continues until either the node becomes
healthy, or max repair attempts has been made.

To use NodeAutoRepair, create a class that implements the AutoRepair interface.
The `repair` function is called when a node needs to be repaired. It should find
the problem, and then attempt to fix it. Multiple attempts can be made to fix
the problem. For example, if one fix didn't work, then a different fix could be
tried.

## Example

```ts
import { NodeAutoRepair, AutoRepair } from 'node-auto-repair';

class CustomAutoRepair implements AutoRepair {
  async repair(apiObj: V1Node, attempts: number): Promise<void> {
    console.log(
      'Attempt #' + attempts + ' to repair node ' + apiObj.metadata.name,
    );

    // Do something to repair node
    await findTheProblem();
    await attemptToFixTheProblem();
  }

  repairAttemptFailed(apiObj: V1Node, attempts: number): void {
    console.log(
      'Attempt #' +
        attempts +
        ' to repair node ' +
        apiObj.metadata.name +
        ' failed',
    );
  }

  repairAttemptsFailed(apiObj: V1Node, attempts: number): void {
    console.log(
      'Failed to repair node ' +
        apiObj.metadata.name +
        ' after ' +
        attempts +
        ' attempts',
    );
  }

  repairSuccess(apiObj: V1Node, attempts: number): void {
    console.log(
      'Repaired node ' +
        apiObj.metadata.name +
        ' after ' +
        attempts +
        ' attempts',
    );
  }
}

const NodeAutoRepair = new NodeAutoRepair(new CustomAutoRepair(), {
  kubeConfigPath: 'path/to/kubeconfig',
});

NodeAutoRepair.start();
```
