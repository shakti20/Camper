const {campgroundSchema} = require('./JoiValidationSchema');
const ExpressError = require('./utils/ExpressError');
const Campground = require('./models/campground');



module.exports.isLoggedIn = (req, res, next) => {
    if(!req.isAuthenticated()) {
        req.flash('error', 'You must be signed in first!');
        return res.redirect('/login')
    }
    next();
}
module.exports.validateCampground = (req, res, next) => {
    // form data error(handle Express/mongoose error) validation with joi tool/package, this camgroundSchema does not belongs to mongoose, belongs to joi. -- 
    
    const {error} = campgroundSchema.validate(req.body);
    if(error) {
        // details - is an array of objects -
        const msg = error.details.map(el => el.message).join(',')
        throw new ExpressError(msg, 400)
    }else{
        next();
    }
}

module.exports.isAuthor = async (req, res, next) => {
    const {id} = req.params;
    const campground = await Campground.findById(id);
    if(!campground.author.equals(req.user._id)){
        req.flash('error', 'You do not have permission!');
        res.redirect(`/campgrounds/${id}`)
    }
    next();
}