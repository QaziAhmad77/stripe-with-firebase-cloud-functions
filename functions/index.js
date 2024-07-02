/* eslint-disable no-undef */
const admin = require('firebase-admin');
const express = require('express');
const app = express();
const { onRequest } = require("firebase-functions/v2/https");
const stripe = require('stripe')(process.env.API_SECRETE_KEY);
const credentials = require('./key.json');
const logger = require("firebase-functions/logger");
const cors = require('cors')({ origin: true });
const bodyParser = require('body-parser');

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(credentials),
});
const db = admin.firestore();

// Middleware setup
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.json());
app.use(cors);

// Create checkout session function
exports.createCheckoutSession = onRequest((req, res) => {
    cors(req, res, async () => {
        try {
            const { deal } = req.body;
            const unitAmountCents = Math.round(deal.amount * 100);
            console.log(deal, "deal")
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
                success_url: 'http://localhost:5173/connected-caregivers',
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
                    credits: deal.credits,
                    userId: deal.userId,
                    userName: deal.userName,
                    userProfile: deal.profileUrl,
                },
            });

            res.json({ id: session.id });
        } catch (err) {
            logger.error('Error while creating Stripe session', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

// Stripe webhook endpoint
exports.webhook = onRequest((req, res) => {
    cors(req, res, async () => {
        const endpointSecret = process.env.WEB_HOOK_SECRET_KEY;
        const sig = req.headers['stripe-signature'];
        let event;
        try {
            event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
            console.log('Event type:', event.type);

            if (event.type === 'checkout.session.completed') {
                const session = event.data.object;

                const { amount, credits, userId, userName, userProfile, ssnNo, docId } = session.metadata;

                if (userId) {
                    // Fetch the user document first
                    const userDoc = await db.collection('Careusers').doc(userId).get();
                    if (userDoc.exists) {
                        const currentCredits = userDoc.data().credits || 0;
                        const newCredits = currentCredits + parseInt(credits);

                        // Update the user credits
                        await db.collection('Careusers').doc(userId).update({
                            credits: newCredits
                        });

                        // Log the credits transaction
                        await db.collection('CreditsTransactionHistory').add({
                            amount: parseInt(amount),
                            createdOn: new Date(session.created * 1000),
                            credits: parseInt(credits),
                            userId: userId,
                            status: 'buy',
                            userName: userName,
                            userProfile: userProfile,
                        });

                        logger.info('User credits updated successfully.');
                    } else {
                        logger.error('User not found in Careusers collection.');
                    }
                } else if (ssnNo && docId) {
                    await db.collection('Caregivers').doc(docId).update({
                        hasVerificationAmountPaid: true,
                        socialSecurityNumber: ssnNo,
                    });

                    logger.info('Caregiver verification updated successfully.');
                }
            }

            res.json({ received: true });
        } catch (err) {
            logger.error('Webhook signature verification failed', err);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }
    });
});

// exports.helloWorld = onRequest((request, response) => {
//     cors(request, response, () => {
//         logger.info("Hello logs!", { structuredData: true });
//         response.send("Hello from Firebase!");
//     });
// });
