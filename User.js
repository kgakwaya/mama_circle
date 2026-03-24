const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['mother', 'moderator', 'admin'],
        default: 'mother'
    },
    joinedGroups: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group'
    }]
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
