export const CREDIT_PLANS = [
  {
    id: 'starter', name: 'Starter', amountPaise: 45000, credits: 500,
    features: ['500 credits (50 bonus credits)', 'One-time payment', 'Account-linked credit balance', 'Payment receipt in your account'],
  },
  {
    id: 'creator', name: 'Creator', amountPaise: 85000, credits: 1000, popular: true,
    features: ['1,000 credits (150 bonus credits)', 'One-time payment', 'Account-linked credit balance', 'Payment receipt in your account'],
  },
  {
    id: 'studio', name: 'Studio', amountPaise: 99900, credits: 1500,
    features: ['1,500 credits (501 bonus credits)', 'One-time payment', 'Account-linked credit balance', 'Payment receipt in your account'],
  },
].map((plan) => ({ ...plan, currency: 'INR', discountPercent: 30, compareAtPaise: Math.round(plan.amountPaise / 0.7) }));

export const publicPlan = ({ id, name, amountPaise, credits, features, popular, currency, discountPercent, compareAtPaise }) => ({
  id, name, amountPaise, credits, features, popular: !!popular, currency, discountPercent, compareAtPaise,
});
