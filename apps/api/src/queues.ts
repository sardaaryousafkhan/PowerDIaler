/** Job payloads shared by BullMQ workers and demo in-process queue. */
export type DialNextJob = { campaignId: string };

export type SmsSendJob = {
  campaignId: string;
  contactId: string;
  body: string;
};
