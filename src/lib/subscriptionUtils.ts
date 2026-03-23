import type { SubscriptionData } from '@/types/subscription';

const toTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const isPaidPlanActive = (subscription?: SubscriptionData | null): boolean => {
  if (!subscription || subscription.plan_type !== 'paid') return false;

  // Lifetime/indefinite plans may not have an end date.
  if (!subscription.subscription_end_date) return true;

  const subscriptionEndTime = toTimestamp(subscription.subscription_end_date);
  return subscriptionEndTime !== null && subscriptionEndTime >= Date.now();
};

export const isPaidPlanExpired = (subscription?: SubscriptionData | null): boolean => {
  if (!subscription || subscription.plan_type !== 'paid') return false;
  if (!subscription.subscription_end_date) return false;

  const subscriptionEndTime = toTimestamp(subscription.subscription_end_date);
  return subscriptionEndTime !== null && subscriptionEndTime < Date.now();
};

export const isFreeTrialWindowActive = (subscription?: SubscriptionData | null): boolean => {
  if (!subscription || subscription.plan_type !== 'free_trial') return false;

  const subscriptionEndTime = toTimestamp(subscription.subscription_end_date);
  return subscriptionEndTime !== null && subscriptionEndTime >= Date.now();
};
