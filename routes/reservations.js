var express = require('express');
var router = express.Router();
let mongoose = require('mongoose');
let { checkLogin } = require('../utils/authHandler.js.js');
let reservationModel = require('../schemas/reservations');
let cartModel = require('../schemas/cart');
let productModel = require('../schemas/products');
let inventoryModel = require('../schemas/inventories');

// GET all reservations của user
router.get('/', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservations = await reservationModel.find({ 
            user: userId 
        }).populate('items.product').populate('user');
        
        res.json({
            success: true,
            count: reservations.length,
            data: reservations
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching reservations",
            error: error.message
        });
    }
});

// GET 1 reservation theo ID của user
router.get('/:id', checkLogin, async function (req, res, next) {
    try {
        let reservationId = req.params.id;
        let userId = req.userId;
        
        let reservation = await reservationModel.findOne({
            _id: reservationId,
            user: userId
        }).populate('items.product').populate('user');
        
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: "Reservation not found"
            });
        }
        
        res.json({
            success: true,
            data: reservation
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching reservation",
            error: error.message
        });
    }
});

// POST reserve toàn bộ cart
router.post('/reserveACart', checkLogin, async function (req, res, next) {
    const session = await mongoose.startSession();
    
    try {
        let result = await session.withTransaction(async () => {
            let userId = req.userId;
            
            // Lấy cart của user
            let cart = await cartModel.findOne({ user: userId }).populate('items.product').session(session);
            
            if (!cart || cart.items.length === 0) {
                throw new Error('Cart is empty or not found');
            }

            // Kiểm tra xem user đã có reservation active chưa
            let existingReservation = await reservationModel.findOne({
                user: userId,
                status: 'actived'
            }).session(session);

            if (existingReservation) {
                throw new Error('User already has an active reservation');
            }

            let reservationItems = [];
            let totalAmount = 0;

            // Xử lý từng item trong cart
            for (let cartItem of cart.items) {
                let product = cartItem.product;
                let quantity = cartItem.quantity;

                // Kiểm tra inventory
                let inventory = await inventoryModel.findOne({ product: product._id }).session(session);
                if (!inventory || inventory.stock < quantity) {
                    throw new Error(`Insufficient stock for product: ${product.title}`);
                }

                // Cập nhật inventory (giảm stock, tăng reserved)
                await inventoryModel.updateOne(
                    { product: product._id },
                    { 
                        $inc: { 
                            stock: -quantity,
                            reserved: quantity 
                        } 
                    },
                    { session }
                );

                let subtotal = product.price * quantity;
                totalAmount += subtotal;

                reservationItems.push({
                    product: product._id,
                    quantity: quantity,
                    price: product.price,
                    subtotal: subtotal
                });
            }

            // Tạo reservation mới
            let newReservation = new reservationModel({
                user: userId,
                items: reservationItems,
                totalAmount: totalAmount,
                status: 'actived',
                ExpiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 giờ
            });

            await newReservation.save({ session });

            // Xóa cart sau khi reserve thành công
            await cartModel.updateOne(
                { user: userId },
                { $set: { items: [] } },
                { session }
            );

            return newReservation;
        });
        
        res.json({
            success: true,
            message: "Cart reserved successfully",
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: "Error reserving cart",
            error: error.message
        });
    } finally {
        await session.endSession();
    }
});

// POST reserve các items cụ thể
router.post('/reserveItems', checkLogin, async function (req, res, next) {
    const session = await mongoose.startSession();
    
    try {
        let result = await session.withTransaction(async () => {
            let userId = req.userId;
            let { items } = req.body;
            
            if (!items || !Array.isArray(items)) {
                throw new Error("Items array is required");
            }
            
            // Validate items format
            for (let item of items) {
                if (!item.product || !item.quantity || item.quantity <= 0) {
                    throw new Error("Each item must have product ID and valid quantity");
                }
            }
            
            // Kiểm tra xem user đã có reservation active chưa
            let existingReservation = await reservationModel.findOne({
                user: userId,
                status: 'actived'
            }).session(session);

            if (existingReservation) {
                throw new Error('User already has an active reservation');
            }

            let reservationItems = [];
            let totalAmount = 0;

            // Xử lý từng item
            for (let item of items) {
                let product = await productModel.findById(item.product).session(session);
                if (!product || product.isDeleted) {
                    throw new Error(`Product not found: ${item.product}`);
                }

                // Kiểm tra inventory
                let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
                if (!inventory || inventory.stock < item.quantity) {
                    throw new Error(`Insufficient stock for product: ${product.title}`);
                }

                // Cập nhật inventory
                await inventoryModel.updateOne(
                    { product: item.product },
                    { 
                        $inc: { 
                            stock: -item.quantity,
                            reserved: item.quantity 
                        } 
                    },
                    { session }
                );

                let subtotal = product.price * item.quantity;
                totalAmount += subtotal;

                reservationItems.push({
                    product: item.product,
                    quantity: item.quantity,
                    price: product.price,
                    subtotal: subtotal
                });
            }

            // Tạo reservation mới
            let newReservation = new reservationModel({
                user: userId,
                items: reservationItems,
                totalAmount: totalAmount,
                status: 'actived',
                ExpiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 giờ
            });

            await newReservation.save({ session });
            return newReservation;
        });
        
        res.json({
            success: true,
            message: "Items reserved successfully",
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: "Error reserving items",
            error: error.message
        });
    } finally {
        await session.endSession();
    }
});

// POST cancel reservation (không cần transaction)
router.post('/cancelReserve/:id', checkLogin, async function (req, res, next) {
    try {
        let reservationId = req.params.id;
        let userId = req.userId;
        
        let reservation = await reservationModel.findOne({
            _id: reservationId,
            user: userId,
            status: 'actived'
        });

        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found or already processed'
            });
        }

        // Hoàn trả inventory
        for (let item of reservation.items) {
            await inventoryModel.updateOne(
                { product: item.product },
                { 
                    $inc: { 
                        stock: item.quantity,
                        reserved: -item.quantity 
                    } 
                }
            );
        }

        // Cập nhật status reservation
        reservation.status = 'cancelled';
        await reservation.save();
        
        res.json({
            success: true,
            message: "Reservation cancelled successfully",
            data: reservation
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: "Error cancelling reservation",
            error: error.message
        });
    }
});

module.exports = router;