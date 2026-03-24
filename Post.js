const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    content: {
        type: String,
        required: true
    },
    isAnonymous: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['active', 'flagged', 'removed'],
        default: 'active'
    },
    comments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment'
    }],
    reports: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model('Post', PostSchema);
