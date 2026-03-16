var express = require('express');
var router = express.Router();
let mongoose = require('mongoose');
let modelReservation = require('../schemas/reservations');
let modelProduct = require('../schemas/products');

/* GET all reservations of user */
// GET /api/v1/reservations
router.get('/', async function (req, res, next) {
  try {
    let userId = req.query.userId || req.headers.userid; // Có thể lấy từ query hoặc header
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    let reservations = await modelReservation.find({ 
      userId: userId,
      isDeleted: false 
    }).populate('items.productId');
    
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

/* GET single reservation by ID */
// GET /api/v1/reservations/:id
router.get('/:id', async function (req, res, next) {
  try {
    let reservationId = req.params.id;
    let userId = req.query.userId || req.headers.userid;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    let reservation = await modelReservation.findOne({
      _id: reservationId,
      userId: userId,
      isDeleted: false
    }).populate('items.productId');
    
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

/* POST reserve a cart */
// POST /api/v1/reservations/reserveACart
router.post('/reserveACart', async function (req, res, next) {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      let { userId, cartItems, totalAmount } = req.body;
      
      if (!userId || !cartItems || !Array.isArray(cartItems)) {
        throw new Error("Invalid request data");
      }

      // Validate products and check availability
      for (let item of cartItems) {
        let product = await modelProduct.findById(item.productId).session(session);
        if (!product || product.isDeleted) {
          throw new Error(`Product ${item.productId} not found`);
        }
        // Add stock validation if needed
      }

      // Create reservation
      let newReservation = new modelReservation({
        userId: userId,
        items: cartItems.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price
        })),
        totalAmount: totalAmount || cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        status: 'reserved',
        reservedAt: new Date()
      });

      await newReservation.save({ session });
      
      res.json({
        success: true,
        message: "Cart reserved successfully",
        data: newReservation
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error reserving cart",
      error: error.message
    });
  } finally {
    await session.endSession();
  }
});

/* POST reserve items */
// POST /api/v1/reservations/reserveItems
router.post('/reserveItems', async function (req, res, next) {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      let { userId, items } = req.body;
      
      if (!userId || !items || !Array.isArray(items)) {
        throw new Error("Invalid request data. Required: userId, items (array)");
      }

      let reservationItems = [];
      let totalAmount = 0;

      // Process each item
      for (let item of items) {
        if (!item.productId || !item.quantity) {
          throw new Error("Each item must have productId and quantity");
        }

        let product = await modelProduct.findById(item.productId).session(session);
        if (!product || product.isDeleted) {
          throw new Error(`Product ${item.productId} not found`);
        }

        let itemTotal = product.price * item.quantity;
        totalAmount += itemTotal;

        reservationItems.push({
          productId: item.productId,
          quantity: item.quantity,
          price: product.price
        });
      }

      // Create reservation
      let newReservation = new modelReservation({
        userId: userId,
        items: reservationItems,
        totalAmount: totalAmount,
        status: 'reserved',
        reservedAt: new Date()
      });

      await newReservation.save({ session });
      
      res.json({
        success: true,
        message: "Items reserved successfully",
        data: newReservation
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error reserving items",
      error: error.message
    });
  } finally {
    await session.endSession();
  }
});

/* POST cancel reservation */
// POST /api/v1/reservations/cancelReserve/:id
router.post('/cancelReserve/:id', async function (req, res, next) {
  try {
    let reservationId = req.params.id;
    let userId = req.body.userId || req.headers.userid;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    // Find and update reservation (no transaction needed for cancel)
    let reservation = await modelReservation.findOneAndUpdate(
      {
        _id: reservationId,
        userId: userId,
        status: 'reserved'
      },
      {
        status: 'cancelled',
        cancelledAt: new Date()
      },
      { new: true }
    );
    
    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: "Reservation not found or already cancelled"
      });
    }
    
    res.json({
      success: true,
      message: "Reservation cancelled successfully",
      data: reservation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error cancelling reservation",
      error: error.message
    });
  }
});

module.exports = router;