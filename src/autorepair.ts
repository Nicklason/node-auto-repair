import * as k8s from '@kubernetes/client-node';

export interface AutoRepair {
  /**
   * Function called when a repair attempt needs to be made
   * @param apiObj The node to repair
   * @param attempts The current number of attempts to repair the node
   */
  repair(apiObj: k8s.V1Node, attempts: number): Promise<void>;

  /**
   * Function called when a node is healthy again
   * @param apiObj
   * @param attempts The number of repair attempts
   */
  repairSuccess(apiObj: k8s.V1Node, attempts: number): void;

  /**
   * Function called when a repair attempt didn't result in the node being healthy after a given period of time
   * @param apiObj The node that failed to be repaired
   * @param attempts The current number of attempts to repair the node
   */
  repairAttemptFailed(apiObj: k8s.V1Node, attempts: number): void;

  /**
   * Function called when all repair attempts have failed
   * @param apiObj The node that failed to be repaired
   * @param attempts The number of failed repair attempts
   */
  repairAttemptsFailed(apiObj: k8s.V1Node, attempts: number): void;
}
