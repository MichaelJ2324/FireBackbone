const gulp = require('gulp'),
    gp_concat = require('gulp-concat'),
    gp_rename = require('gulp-rename'),
    gp_uglify = require('gulp-uglify');


gulp.task('js-min',function(){
    return gulp.src('./firebaseDBackbone.js')
        .pipe(gp_uglify())
        .pipe(gp_rename('firebaseDBackbone-min.js'))
        .pipe(gulp.dest('.'));
});

gulp.task('default', [ 'js-min']);