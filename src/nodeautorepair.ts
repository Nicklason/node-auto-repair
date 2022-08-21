import * as k8s from '@kubernetes/client-node';
import PQueue from 'p-queue';
import { AutoRepair } from './autorepair.js';

export interface NodeAutoRepairOptions {
  /**
   * Absolute path to kubeconfig file
   */
  kubeConfigPath: string;
  /**
   * Max amount of nodes to repair concurrently
   */
  concurrency: number;
  /**
   * Max number of repair attempts
   */
  maxAttempts: number;
  /**
   * Amount of time a node needs to be unhealthy before first repair attempt will be made
   */
  unhealthyTime: number;
  /**
   * Amount of time to wait between repair attempts
   */
  repairTimeout: number;
}

/**
 * Class that watches for node changes
 */
export class NodeAutoRepair {
  private options: NodeAutoRepairOptions;
  private autoRepair: AutoRepair;

  private kc = new k8s.KubeConfig();
  private k8sApi: k8s.CoreV1Api = null;
  private informer: k8s.Informer<k8s.V1Node>;

  private repairQueue: PQueue;
  private brokenNodes: {
    [name: string]: {
      // Number of attempts to repair the node
      attempts: number;
      // Timeout used to add the node to the repair queue
      timeout: NodeJS.Timeout;
    };
  } = {};

  /**
   * Creates a new instance of the NodeAutoRepair class
   * @param autoRepair The AutoRepair class to use for repairing nodes
   * @param options Options for the NodeAutoRepair class
   */
  constructor(autoRepair: AutoRepair, options: NodeAutoRepairOptions) {
    this.autoRepair = autoRepair;
    this.options = options;

    this.repairQueue = new PQueue({ concurrency: this.options.concurrency });
    this.repairQueue.pause();
  }

  /**
   * Start watching for node changes and repairing unhealthy nodes
   */
  async start(): Promise<void> {
    this.makeInformer();
    await this.informer.start();
    this.repairQueue.start();
  }

  /**
   * Cleans up by stoping to watch for node changes and stops repairing new nodes
   */
  stop(): Promise<void> {
    this.repairQueue.clear();
    return this.informer.stop();
  }

  /**
   * Creates an informer that watches for node changes
   */
  private makeInformer() {
    this.kc.loadFromFile(this.options.kubeConfigPath);

    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    const listFn = () => this.k8sApi.listNode();
    const informer = k8s.makeInformer(this.kc, '/api/v1/nodes', listFn);

    informer.on('error', (err) => {
      if (err.message === 'aborted') {
        return;
      }

      setTimeout(() => {
        informer.start();
      }, 5000);
    });

    informer.on('add', (node) => {
      this.handleInformerUpdate(node);
    });
    informer.on('update', (node) => {
      this.handleInformerUpdate(node);
    });

    this.informer = informer;
  }

  /**
   * Function to call when a node is healthy
   * @param node
   */
  private handleHealthyNode(node: k8s.V1Node): void {
    const name = this.getNodeName(node);
    const brokenNode = this.brokenNodes[name];

    if (brokenNode) {
      // Node is healthy again, remove it from the broken nodes object
      clearTimeout(brokenNode.timeout);
      if (brokenNode.attempts > 0) {
        this.autoRepair.repairSuccess(node, brokenNode.attempts);
      }
      delete this.brokenNodes[name];
    }
  }

  /**
   * Function that handles node informer events
   * @param node
   */
  private handleInformerUpdate(node: k8s.V1Node): void {
    const name = this.getNodeName(node);

    // Figure out if the node is healthy
    const { isHealthy, lastTransitionTime } = this.isNodeHealthy(node);

    if (isHealthy) {
      this.handleHealthyNode(node);
    } else if (this.brokenNodes[name] === undefined) {
      const downStart = lastTransitionTime;
      const downTime = new Date().getTime() - downStart.getTime();

      // Time to wait before attempting to repair the node
      const wait = Math.max(this.options.unhealthyTime - downTime, 0);

      this.brokenNodes[name] = {
        attempts: 0,
        timeout: setTimeout(() => {
          this.attemptRepair(node);
        }, wait),
      };
    }
  }

  /**
   * Attempt to repair a node
   * @param node
   */
  private attemptRepair(node: k8s.V1Node): void {
    const name = this.getNodeName(node);
    const brokenNode = this.brokenNodes[name];

    // Used to determine if another repair attempt should be made
    let retry = true;

    // Attempting to get node to make sure control plane is responsive
    this.k8sApi
      .readNode(name)
      .then((result) => {
        return result.body;
      })
      .then((refreshedNode) => {
        const { isHealthy } = this.isNodeHealthy(refreshedNode);

        if (isHealthy) {
          retry = false;
          this.handleHealthyNode(refreshedNode);
        } else {
          return this.repairQueue.add(() => {
            // Attempt to repair the node
            brokenNode.attempts++;
            return this.autoRepair.repair(node, brokenNode.attempts);
          });
        }
      })
      .finally(() => {
        if (retry) {
          // Attempted repair

          brokenNode.timeout = setTimeout(() => {
            this.handleStillUnhealthyNode(node);
          }, this.options.repairTimeout);
        }
      });
  }

  /**
   * Function used to get name of a node
   * @param node
   */
  private getNodeName(node: k8s.V1Node): string {
    return node.metadata.name;
  }

  /**
   * Function called when a repair attempt failed
   * @param node
   */
  private handleStillUnhealthyNode(node: k8s.V1Node): void {
    const name = this.getNodeName(node);
    const brokenNode = this.brokenNodes[name];

    // Notify that repair attempt failed
    this.autoRepair.repairAttemptFailed(node, brokenNode.attempts);

    if (brokenNode.attempts >= this.options.maxAttempts) {
      // Too many attempts, give up
      this.autoRepair.repairAttemptsFailed(node, brokenNode.attempts);
      return;
    }

    // Retry repair
    this.attemptRepair(node);
  }

  /**
   * Function to determine if a node is healthy
   * @param node
   */
  private isNodeHealthy(node: k8s.V1Node): {
    isHealthy: boolean;
    lastTransitionTime: Date;
  } {
    const readyCondition = node.status.conditions.find((condition) => {
      return condition.type === 'Ready';
    });

    const isReady = readyCondition.status === 'True';

    return {
      isHealthy: isReady,
      lastTransitionTime: new Date(readyCondition.lastTransitionTime),
    };
  }
}
