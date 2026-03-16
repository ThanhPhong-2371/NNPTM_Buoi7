let mongoose = require('mongoose');

let itemOrderSchema = mongoose.Schema({
    product: {
        type: mongoose.Types.ObjectId,
        ref: 'product',
    },
    quantity: {
        type: Number,
        min: 1
    },
    price: {
        type: Number,
        min: 0
    },
    subtotal: {
        type: Number,
        min: 0
    }
}, {
    _id: false
})

let orderSchema = mongoose.Schema({
    user: {
        type: mongoose.Types.ObjectId,
        ref: 'user',
        required: true
    },
    reservation: {
        type: mongoose.Types.ObjectId,
        ref: 'reservation'
    },
    items: [itemOrderSchema],
    totalAmount: {
        type: Number,
        required: true
    },
    paymentStatus: {
        type: String,
        enum: ["pending", "completed", "failed"],
        default: "completed"
    },
    shippingAddress: {
        type: String
    }
}, {
    timestamps: true
})

module.exports = mongoose.model('order', orderSchema);
