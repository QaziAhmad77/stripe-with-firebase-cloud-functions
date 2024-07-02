/* eslint-disable no-undef */
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const credentials = require('../key.json');
const stripe = require('stripe')(process.env.API_SECRETE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});

const db = admin.firestore();

// checkout api
router.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { deal } = req.body;
    const unitAmountCents = Math.round(deal.amount * 100);
    const lineItems = [
      {
        price_data: {
          currency: 'USD',
          product_data: {
            name: deal?.deal,
          },
          unit_amount: unitAmountCents,
        },
        quantity: 1,
      },
    ];
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: 'http://localhost:5173/success',
      cancel_url: 'http://localhost:5173/cancel',
      custom_fields: [
        {
          key: 'zipcode',
          label: {
            type: 'custom',
            custom: 'Zip Code',
          },
          type: 'numeric',
        },
      ],
      metadata: {
        amount: deal.amount,
        credits: deal.credits, // Replace with actual user ID
        userId: deal.userId,
        userName: deal.userName,
        userProfile: deal.profileUrl,
      },
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error(err, 'Error while creating Stripe session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/ssn-payment', async (req, res) => {
  try {
    const { data, docId } = req.body;
    const unitAmountCents = Math.round(25 * 100);
    const lineItems = [
      {
        price_data: {
          currency: 'USD',
          product_data: {
            name: data.ssn,
          },
          unit_amount: unitAmountCents,
        },
        quantity: 1,
      },
    ];
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: 'http://localhost:5173/profile-under-observation',
      cancel_url: 'http://localhost:5173/cancel',
      custom_fields: [
        {
          key: 'zipcode',
          label: {
            type: 'custom',
            custom: 'Zip Code',
          },
          type: 'numeric',
        },
      ],
      metadata: {
        ssnNo: data.ssn,
        docId: docId,
      },
    });
    console.log(session.id, "id")
    res.json({ id: session.id });
  } catch (err) {
    console.error(err, 'Error while creating Stripe session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stripe webhook endpoint
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const endpointSecret =
      'Your_Webhook_Secret_Key';
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
      console.log(event.type, 'event.type');
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log(session, "session completed")
        // console.log(session, 'event.data.object');
        const { amount, credits, userId, userName, userProfile, ssnNo, docId } =
          session.metadata;
        if (amount || credits || userId || userName || userProfile) {
          await db
            .collection('Careusers')
            .doc(userId)
            .update({
              credits: admin.firestore.FieldValue.increment(parseInt(credits)),
            });
          await db.collection('CreditsTransactionHistory').add({
            amount: parseInt(amount),
            createdOn: new Date(session.created * 1000),
            credits: parseInt(credits),
            userId: userId,
            status: 'spent',
            userName: userName,
            userProfile: userProfile,
          });
        } else if (ssnNo || docId) {
          await db.collection('Caregivers').doc(docId).update({
            hasVerificationAmountPaid: true,
            socialSecurityNumber: ssnNo,
          });
        }
        console.log('Payment success. Transaction details saved to Firebase.');
      }
      res.json({ received: true });
    } catch (err) {
      console.error(err, 'Webhook signature verification failed');
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

module.exports = router;
