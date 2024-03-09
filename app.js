if (process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}

const express = require('express');
const methodOverride = require('method-override')
const path = require('path');
const mongoose = require('mongoose');
const ejsMate = require('ejs-mate');
const catchAsync = require('./utils/catchAsync')
const Campground = require('./models/campground');
const ExpressError = require('./utils/ExpressError');
const capitalize = require('./utils/capitalise');
const { reviewSchema } = require('./JoiValidationSchema');
const {isLoggedIn, validateCampground, isAuthor} = require('./middleware');
const Review = require('./models/review');
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/user');  
const multer  = require('multer');
const {storage, cloudinary} = require('./cloudinary');
const upload = multer({ storage: storage });
const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");
const mapBoxToken = process.env.MAPBOX_TOKEN;
const geocoder = mbxGeocoding({ accessToken: mapBoxToken });
const mongoSanitize = require('express-mongo-sanitize');
const MongoStore = require('connect-mongo');
const dbUrl = process.env.DB_URL ||'mongodb://127.0.0.1:27017/yelp-camp';
mongoose.connect(dbUrl);

// const db = mongoose.connection;
mongoose.connection.on("error", console.error.bind(console, "connection error:"));
mongoose.connection.once("open", () => {
    console.log("Database connected");
});

const app = express();

app.engine('ejs', ejsMate);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(mongoSanitize({
    replaceWith: '_'
}))

const secret = process.env.SECRET || 'confidentialtext!';

const store = MongoStore.create({
    mongoUrl: dbUrl,
    touchAfter: 24 * 60 * 60,
    crypto: {
        secret
    }
});

store.on("error", function (e) {
    console.log("SESSION STORE ERROR", e)
})

const sessionConfig = {
    store,
    name: 'session',
    secret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        // secure: true, 
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 60 * 7
    }
}
app.use(session(sessionConfig));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

// storing user in session and out of session.
passport.serializeUser(User.serializeUser())
passport.deserializeUser(User.deserializeUser())

// middlewere for flash messages
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
})

const validateReview = (req, res, next) => {
    // form data error(handle Express/mongoose error) validation with joi tool/package, this camgroundSchema does not belongs to mongoose, belongs to joi. -- 
    
    const {error} = reviewSchema.validate(req.body);
    if(error) {
        // details - is an array of objects -
        const msg = error.details.map(el => el.message).join(',')
        throw new ExpressError(msg, 400)
    }else{
        next();
    }
}

app.get('/', (req,res) => {
    res.render('home')
})

app.get('/campgrounds', catchAsync( async (req,res) => {
    const campgrounds = await Campground.find({});
    res.render('campgrounds/index', {campgrounds})
}))

app.get('/campgrounds/new', isLoggedIn, (req,res) => {
    res.render('campgrounds/new')
})

app.post('/campgrounds', isLoggedIn, upload.array('image'), validateCampground, catchAsync( async(req, res, next) => {
    // if(!req.body.campground) throw new ExpressError('Invalid Campground Data', 400);
    const geoData = await geocoder.forwardGeocode({
        query: req.body.campground.location,
        limit: 1
    }).send()

    const campground = new Campground(req.body.campground);
    campground.geometry = geoData.body.features[0].geometry;
    campground.images = req.files.map(f => ({url: f.path, filename: f.filename}));
    campground.author = req.user._id;
    await campground.save();
    console.log(campground.images);
    req.flash('success', 'Successfully made a new Campground');
    res.redirect(`/campgrounds/${campground._id}`)
    
    // console.dir(req.body);
    // console.dir(req.body.campground);
}))
// app.post('/campgrounds', upload.array('image'), (req, res) => {
//     console.log(req.body, req.files);
//     res.send("Worked!!!!!!");
// })

app.get('/campgrounds/:id/edit', isAuthor, catchAsync( async (req,res) => {
    const campground = await Campground.findById(req.params.id);
    if(!campground){
        req.flash('error', 'Campground does not exist');
        return res.redirect('/campgrounds');
    }
    res.render('campgrounds/edit', {campground});
}))

app.get('/campgrounds/:id', catchAsync( async (req,res) => {
    // console.dir(req.params);
    const campground = await Campground.findById(req.params.id).populate({
        path: 'reviews',
        populate: {
            path: 'author'
        }
    }).populate('author');
    if(!campground){
        req.flash('error', 'Campground does not exist')
        return res.redirect('/campgrounds')
    }
    res.render('campgrounds/show', {campground});
    
}))
app.put('/campgrounds/:id', isLoggedIn, isAuthor,upload.array('image'), validateCampground, catchAsync( async (req,res) => {
    const {id} = req.params;
    console.log(req.body);
    const campground = await Campground.findByIdAndUpdate(id, {...req.body.campground});
    const imgs = req.files.map(f => ({url: f.path, filename: f.filename}));
    campground.images.push(...imgs);
    await campground.save();
    if(req.body.deleteImages){
        for(let filename of req.body.deleteImages){
            await cloudinary.uploader.destroy(filename);
        }
        await campground.updateOne({$pull:{images:{filename:{$in:req.body.deleteImages}}}})
    }
    req.flash('success', 'Successfully updated Campground');
    res.redirect(`/campgrounds/${campground._id}`)
}))
app.delete('/campgrounds/:id',isLoggedIn,isAuthor, catchAsync( async (req,res) => {
    const {id} = req.params;
    await Campground.findByIdAndDelete(id);
    req.flash('success', 'Successfully deleted Campground');
    res.redirect('/campgrounds');
}))

app.post('/campgrounds/:id/reviews', isLoggedIn, validateReview, catchAsync(async (req, res) => {
    const campground = await Campground.findById(req.params.id);
    const review = new Review(req.body.review); // taking new review from form input from show.ejs .
    review.author = req.user._id;
    campground.reviews.push(review); // pushing review in reviews array in campground as per defined model/scehema.
    await campground.save();
    await review.save();
    req.flash('success', 'Review created');
    res.redirect(`/campgrounds/${campground._id}`)

}))

app.delete('/campgrounds/:id/reviews/:reviewId', catchAsync(async (req, res) => {
    const {id, reviewId} = req.params;
    await Campground.findByIdAndUpdate(id, {$pull: {reviews: reviewId}}); // to update or delete a object from array(as per defined model).
    await Review.findByIdAndDelete(reviewId);
    req.flash('success', 'Successfully deleted review');
    res.redirect(`/campgrounds/${id}`);
}))

app.get('/register', (req, res) => {
    res.render('campgrounds/register')
})
app.post('/register', catchAsync(async (req, res, next) => {
    try{
        const {email, username, password} = req.body;
        const user = new User({email, username});
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err => {
            if(err) return next(err);
            req.flash('success',`Welcome to Camper, ${capitalize(username)}`);
            res.redirect('/campgrounds');
        })               
    } catch (e){
        req.flash('error', e.message);
        res.redirect('register');
    }
       
}));

app.get('/login', (req, res) => {
    res.render('campgrounds/login');
})
app.post('/login', passport.authenticate('local', {failureFlash: true, failureRedirect: '/login'}),  (req, res) => {
    const {username} = req.body;
    req.flash('success', `Welcome Back!, ${capitalize(username)}`);
    res.redirect('/campgrounds');
    
})
app.get('/logout', (req, res, next) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        req.flash('success', 'Goodbye!');
        res.redirect('/campgrounds');
    });
}); 

// app.get('/makecampground', async (req, res) => {
//     const camp = new Campground({ title: 'My Backyard'});
//     await camp.save();
//     res.send(camp);
// })

// if No route is found/match after all above routes then it will used-
app.all('*', (req, res, next) => {
    next(new ExpressError('Page Not Found', 404));
})

// Cath all error middleware function for errors-
// app.use((err, req, res, next) => {
//     res.send('Something went wrong');
// })

// Cath all error middleware function for errors-
app.use((err, req, res, next) => {
    const {statusCode = 500} = err;
    if(!err.message) err.message = 'Something went wrong!';
    res.status(statusCode).render('error',{err});
    
})

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Serving on port ${port}`)
})