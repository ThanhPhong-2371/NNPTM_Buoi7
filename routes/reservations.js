var express = require('express');
var router = express.Router();
const mongoose = require('mongoose');
let { checkLogin } = require('../utils/authHandler.js');
let reservationModel = require('../schemas/reservations');
let cartModel = require('../schemas/cart');
let inventoryModel = require('../schemas/inventories');
let productModel = require('../schemas/products');


router.get('/', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservations = await reservationModel.find({ user: userId }).populate('items.product');
        res.send(reservations);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});


router.get('/:id', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservation = await reservationModel.findOne({ _id: req.params.id, user: userId }).populate('items.product');
        if (!reservation) {
            return res.status(404).send({ message: "Reservation not found" });
        }
        res.send(reservation);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});


router.post('/reserveACart', checkLogin, async function (req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let userId = req.userId;
        let currentCart = await cartModel.findOne({ user: userId }).populate('items.product');

        if (!currentCart || currentCart.items.length === 0) {
            throw new Error("Cart is empty");
        }

        let reservationItems = [];
        let totalAmount = 0;

        for (let item of currentCart.items) {
            let product = item.product;
            let quantity = item.quantity;

            let inventory = await inventoryModel.findOne({ product: product._id }).session(session);
            if (!inventory || inventory.stock < quantity) {
                throw new Error(`Product ${product.title} is out of stock`);
            }


            inventory.stock -= quantity;
            inventory.reserved += quantity;
            await inventory.save({ session });

            let subtotal = product.price * quantity;
            reservationItems.push({
                product: product._id,
                quantity: quantity,
                price: product.price,
                subtotal: subtotal
            });
            totalAmount += subtotal;
        }

        let newReservation = new reservationModel({
            user: userId,
            items: reservationItems,
            totalAmount: totalAmount,
            status: "actived",
            ExpiredAt: new Date(Date.now() + 15 * 60 * 1000) // 15 mins expiry
        });

        await newReservation.save({ session });


        currentCart.items = [];
        await currentCart.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.send(newReservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: error.message });
    }
});


router.post('/reserveItems', checkLogin, async function (req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let userId = req.userId;
        let { items } = req.body; // Expecting { items: [{ product: id, quantity: n }] }

        if (!items || !Array.isArray(items) || items.length === 0) {
            throw new Error("Items list is required");
        }

        let reservationItems = [];
        let totalAmount = 0;

        for (let item of items) {
            let product = await productModel.findById(item.product);
            if (!product) {
                throw new Error(`Product ${item.product} not found`);
            }
            let quantity = item.quantity;

            let inventory = await inventoryModel.findOne({ product: product._id }).session(session);
            if (!inventory || inventory.stock < quantity) {
                throw new Error(`Product ${product.title} is out of stock`);
            }


            inventory.stock -= quantity;
            inventory.reserved += quantity;
            await inventory.save({ session });

            let subtotal = product.price * quantity;
            reservationItems.push({
                product: product._id,
                quantity: quantity,
                price: product.price,
                subtotal: subtotal
            });
            totalAmount += subtotal;
        }

        let newReservation = new reservationModel({
            user: userId,
            items: reservationItems,
            totalAmount: totalAmount,
            status: "actived",
            ExpiredAt: new Date(Date.now() + 30 * 60 * 1000)
        });

        await newReservation.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.send(newReservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: error.message });
    }
});


router.post('/cancelReserve/:id', checkLogin, async function (req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let userId = req.userId;
        let reservationId = req.params.id;

        let reservation = await reservationModel.findOne({ _id: reservationId, user: userId }).session(session);
        if (!reservation) {
            throw new Error("Reservation not found");
        }

        if (reservation.status !== "actived") {
            throw new Error("Only active reservations can be cancelled");
        }

        for (let item of reservation.items) {
            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (inventory) {
                inventory.stock += item.quantity;
                inventory.reserved -= item.quantity;
                await inventory.save({ session });
            }
        }

        reservation.status = "cancelled";
        await reservation.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.send(reservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: error.message });
    }
});

let orderModel = require('../schemas/orders');




router.post('/pay/:id', checkLogin, async function (req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let userId = req.userId;
        let reservationId = req.params.id;

        let reservation = await reservationModel.findOne({ _id: reservationId, user: userId }).session(session);
        if (!reservation) {
            throw new Error("Reservation not found");
        }

        if (reservation.status !== "actived") {
            throw new Error(`Cannot pay for a reservation with status: ${reservation.status}`);
        }

        if (reservation.ExpiredAt < new Date()) {
            reservation.status = "expired";
            await reservation.save({ session });
            throw new Error("Reservation has expired. Please try again.");
        }

        // Logic: Chuyển từ reserved sang soldCount
        for (let item of reservation.items) {
            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (inventory) {
                inventory.reserved -= item.quantity;
                inventory.soldCount += item.quantity;
                await inventory.save({ session });
            }
        }

        // Tạo Order
        let newOrder = new orderModel({
            user: userId,
            reservation: reservation._id,
            items: reservation.items,
            totalAmount: reservation.totalAmount,
            paymentStatus: "completed"
        });
        await newOrder.save({ session });

        // Cập nhật trạng thái reservation
        reservation.status = "paid";
        await reservation.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.send({ message: "Payment successful", order: newOrder });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: error.message });
    }
});


setInterval(async () => {
    const session = await mongoose.startSession();
    try {
        let expiredReservations = await reservationModel.find({
            status: "actived",
            ExpiredAt: { $lt: new Date() }
        });

        for (let res of expiredReservations) {
            session.startTransaction();
            try {
                for (let item of res.items) {
                    let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
                    if (inventory) {
                        inventory.stock += item.quantity;
                        inventory.reserved -= item.quantity;
                        await inventory.save({ session });
                    }
                }
                res.status = "expired";
                await res.save({ session });
                await session.commitTransaction();
                console.log(`[Reservation] ID ${res._id} has expired and stock returned.`);
            } catch (err) {
                await session.abortTransaction();
            }
        }
    } catch (error) {
        console.error("[Reservation Worker] Error:", error.message);
    } finally {
        session.endSession();
    }
}, 60000);


setInterval(async () => {
    const session = await mongoose.startSession();
    try {
        // Tìm các reservation đang "actived" và đã quá hạn
        let expiredReservations = await reservationModel.find({
            status: "actived",
            ExpiredAt: { $lt: new Date() }
        });

        for (let res of expiredReservations) {
            session.startTransaction();
            try {
                for (let item of res.items) {
                    let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
                    if (inventory) {
                        inventory.stock += item.quantity;
                        inventory.reserved -= item.quantity;
                        await inventory.save({ session });
                    }
                }
                res.status = "expired";
                await res.save({ session });
                await session.commitTransaction();
                console.log(`[Reservation] ID ${res._id} has expired and stock returned.`);
            } catch (err) {
                await session.abortTransaction();
                console.error(`[Reservation] Error expiring ID ${res._id}:`, err.message);
            }
        }
    } catch (error) {
        console.error("[Reservation Worker] Error:", error.message);
    } finally {
        session.endSession();
    }
}, 60000); 

module.exports = router;
