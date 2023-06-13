var container,canvas,ctx;
var FLIP_HORIZ = true;
var SCALE = 1/90;
var DRAWSCALE = 1/SCALE;
var SUBSAMPLING = 5; // subsampling of SVG path
var SIMPLIFY = 0.1*SCALE;
var SIMPLIFYHQ = false;
var TRACEWIDTH = 0.1; // in mm

// Start file download.
function download_script(filename, text) {
  var text = document.getElementById("result").value;
  var element = document.createElement('a');

  if (typeof filename === 'undefined') { 
    filename = 'import_svg.scr'; 
  } else {
    var patternFileName = /([^\\\/]+)\.svg$/i;
    var filename= filename.match(patternFileName)[1] + ".scr";
  }

  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();

  document.body.removeChild(element);
}

function dist(a,b) {
  var dx = a.x-b.x;
  var dy = a.y-b.y;
  return Math.sqrt(dx*dx+dy*dy);
}

function isInside(point, poly) {
  // ray-casting algorithm based on
  // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
  var x = point.x, y = point.y;
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i].x, yi = poly[i].y;
    var xj = poly[j].x, yj = poly[j].y;

    var intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

function polygonArea(poly) {
  //https://stackoverflow.com/questions/14505565/detect-if-a-set-of-points-in-an-array-that-are-the-vertices-of-a-complex-polygon
  var area = 0;
  for (var i = 0; i < poly.length; i++) {
    j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return area / 2;
}

// Move a small distance away from path[idxa] towards path[idxb]
function interpPt(path, idxa, idxb) {
  var amt = TRACEWIDTH/8; // a fraction of the trace width so we don't get much of a notch in the line
  // wrap index
  if (idxb<0) idxb+=path.length;
  if (idxb>=path.length) idxb-=path.length;
  // get 2 pts
  var a = path[idxa];
  var b = path[idxb];
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var d = Math.sqrt(dx*dx + dy*dy);
  if (amt > d) return []; // return nothing - will just end up using the last point
  return [{
    x : a.x + (dx*amt/d),
    y : a.y + (dy*amt/d)
  }];
}

function unpackPoly(poly) {
  // ensure all polys are the right way around
  for (var p=0;p<poly.length;p++) {
    if (polygonArea(poly[p])>0)
      poly[p].reverse();
  }
  var finalPolys = [poly[0]];
  for (var p=1;p<poly.length;p++) {
    var path = poly[p];

    var outerPolyIndex = undefined;
    for (var i=0;i<finalPolys.length;i++) {
      if (isInside(path[0], finalPolys[i])) {
        outerPolyIndex = i;
        break;
      } else if (isInside(finalPolys[i][0], path)) {
        // polys in wrong order - old one is inside new one
        var t = path;
        path = finalPolys[i];
        finalPolys[i] = t;
        outerPolyIndex = i;
        break;
      }
    }

    if (outerPolyIndex!==undefined) {
      path.reverse(); // reverse poly
      var outerPoly = finalPolys[outerPolyIndex];
      var minDist = 10000000000;
      var minOuter,minPath;
      for (var a=0;a<outerPoly.length;a++)
        for (var b=0;b<path.length;b++) {
          var l = dist(outerPoly[a],path[b]);
          if (l<minDist) {
            minDist = l;
            minOuter = a;
            minPath = b;
          }
        }
      // splice the inner poly into the outer poly
      // but we have to recess the two joins a little
      // otherwise Eagle reports Invalid poly when filling
      // the top layer
      finalPolys[outerPolyIndex] =
        outerPoly.slice(0, minOuter).concat(
          interpPt(outerPoly,minOuter,minOuter-1),
          interpPt(path,minPath,minPath+1),
          path.slice(minPath+1),
          path.slice(0,minPath),
          interpPt(path,minPath,minPath-1),
          interpPt(outerPoly,minOuter,minOuter+1),
          outerPoly.slice(minOuter+1)
        );
    } else {
      // not inside, just add this poly
      finalPolys.push(path);
    }
  }
  return finalPolys;
}

function plotPoly(points, isFilled) {
  ctx.beginPath();
  ctx.moveTo(points[0].x*DRAWSCALE, points[0].y*DRAWSCALE);
  for (var i=1;i<points.length;i++)
    ctx.lineTo(points[i].x*DRAWSCALE, points[i].y*DRAWSCALE);
  if (isFilled) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
}

function drawSVG() {
  if (container===undefined) return;
  TRACEWIDTH = parseFloat(document.getElementById("traceWidth").value);
  SUBSAMPLING = parseFloat(document.getElementById("subsampling").value);
  FLIP_HORIZ = document.getElementById("flipImage").checked;
  LAYER_COLOR = document.getElementById("layerColor").checked;
  var EAGLE_LAYER = document.getElementById("eagleLayer").value;
  var SIGNAL_NAME = document.getElementById("signalName").value;
  var EAGLE_FORMAT = document.querySelector('input[name="eagleformat"]:checked').value;

  container.style.display="block";

  var logarea = document.getElementById("log");
  logarea.innerHTML = "";
  logarea.style.display = 'none';
  function log(x) {
    logarea.innerHTML += x+"\n";
    logarea.style.display = 'block';
  }

  var dimensions_area = document.getElementById("dimensions");
  dimensions_area.innerHTML = "";
  function dimensions_log(x) {
    dimensions_area.innerHTML += x+"\n";
  }

  var textarea = document.getElementById("result");
  textarea.value = "";
  document.getElementById("dwn-btn").disabled = true;
  function out(x) {
    textarea.value += x;
    document.getElementById("dwn-btn").disabled = false;
  }
  var size = container.viewBox.baseVal;
  if (size.width==0 || size.height==0) {
    size = {
      width : container.width.baseVal.value,
      height : container.height.baseVal.value
    };
  }

  function ChangeLayer(LayerID) {
    if (EAGLE_FORMAT == "board" && !LAYER_COLOR) {
      out("CHANGE layer "+LayerID+"; CHANGE rank 3; CHANGE pour solid; SET WIRE_BEND 2;\n");
    } if (EAGLE_FORMAT == "library") {
      out("CHANGE layer "+LayerID+"; CHANGE pour solid; Grid mm; SET WIRE_BEND 2;\n");
    }
  }

  var LAYER_COLOR = false;
  var COLOR_MAPPING_OFFSET = 0;
  var COLOR_MAPPING = {};

  function LookupLayerForFillColor(fillColor) {
    if (!COLOR_MAPPING.hasOwnProperty(fillColor))
      COLOR_MAPPING[fillColor] = Number(EAGLE_LAYER) + COLOR_MAPPING_OFFSET++;
  
    return COLOR_MAPPING[fillColor];
  }

  var specifiedWidth = container.getAttribute("width");
  if (specifiedWidth && specifiedWidth.match(/[0-9.]*mm/)) {
    specifiedWidth = parseFloat(specifiedWidth.slice(0,-2));
    SCALE = specifiedWidth / size.width;
    log("SVG width detected in mm \\o/");
  } else if (specifiedWidth && specifiedWidth.match(/[0-9.]*in/)) {
    specifiedWidth = parseFloat(specifiedWidth.slice(0,-2))*25.4;
    SCALE = specifiedWidth / size.width;
    log("SVG width detected in inches");
  } else {
    SCALE = 1/parseFloat(document.getElementById("svgScale").value);
    log("SVG width not in mm - GUESSING dimensions based on scale factor");
    log("Try setting document size in mm in Inkscape's Document Properties");
  }
  dimensions_log(`Dimensions ${(size.width*SCALE).toFixed(2)}mm x ${(size.height*SCALE).toFixed(2)}mm`);

  var exportHeight = size.height*SCALE;

  var drawMultiplier = (window.innerWidth-40) / size.width;
  canvas.width = size.width*drawMultiplier;
  canvas.height = size.height*drawMultiplier;
  DRAWSCALE = drawMultiplier / SCALE;

  ChangeLayer(EAGLE_LAYER);

  ctx.beginPath();
  ctx.lineWidth = 1;
  var scale = 1/96;
  var col = 0;
  var paths = container.getElementsByTagName("path");
  if (paths.length==0)
    log("No paths found. Did you use 'Object to path' in Inkscape?");
  var anyVisiblePaths = false;
  var currentLayer = "";
  for (var i=0;i<paths.length;i++) {
    var path = paths[i]; // SVGPathElement
    var filled = (path.style.fill!==undefined && path.style.fill!="" && path.style.fill!="none") || path.hasAttribute('fill');
    var stroked = (path.style.stroke!==undefined && path.style.stroke!="" && path.style.stroke!="none");
    if (!(filled || stroked)) continue; // not drawable (clip path?)
    anyVisiblePaths = true;
    var transform = path.ownerSVGElement.getScreenCTM().inverse().multiply(path.getScreenCTM())
    var l = path.getTotalLength();
    var divs = Math.round(l*SUBSAMPLING);
    if (divs<3) divs = 3;
    var maxLen = l * 1.5 * SCALE / divs;
    var p = path.getPointAtLength(0).matrixTransform(transform);
    if (FLIP_HORIZ) p.x = size.width-p.x;
    p = {x:p.x*SCALE, y:p.y*SCALE};
    var last = p;
    var polys = [];
    var points = [];
    for (var s=0;s<=divs;s++) {
      p = path.getPointAtLength(s*l/divs).matrixTransform(transform);
      if (FLIP_HORIZ) p.x = size.width-p.x;
      p = {x:p.x*SCALE, y:p.y*SCALE};
      if (dist(p,last)>maxLen) {
        if (points.length>1) {
          points = simplify(points, SIMPLIFY, SIMPLIFYHQ);
          polys.push(points);
        }
        //ctx.strokeStyle = `hsl(${col+=20},100%,50%)`;
        //plotPoly(points);
        points = [p];
      } else {
        points.push(p);
      }
      last = p;
    }
    if (points.length>1) {
      points = simplify(points, SIMPLIFY, SIMPLIFYHQ);
      polys.push(points);
    }
    ctx.strokeStyle = `hsl(${col+=40},100%,50%)`;
    ctx.fillStyle = `hsla(${col+=40},100%,50%,0.4)`;

    if(LAYER_COLOR){
      var targetLayer = LookupLayerForFillColor(path.style.fill);
      if (currentLayer != targetLayer) {
        currentLayer = targetLayer;
        ChangeLayer(currentLayer);
      }
    }

    //plotPoly(points);
    if (filled)
      polys = unpackPoly(polys);

    polys.forEach(function (points) {
      if (points.length<2) return;
      plotPoly(points, filled);
      var scriptLine;
      if (filled) {
        // re-add final point so we loop around
        points.push(points[0]);
        if (EAGLE_FORMAT == "board") {
          scriptLine = "polygon "+SIGNAL_NAME+" "+TRACEWIDTH+"mm"
        } if (EAGLE_FORMAT == "library") {
          scriptLine = "polygon "+TRACEWIDTH+"mm"
        }
      } else { // lines
        if (EAGLE_FORMAT == "board") {
          scriptLine = "wire "+SIGNAL_NAME+" "+TRACEWIDTH+"mm"
        } if (EAGLE_FORMAT == "library") {
          scriptLine = "wire "+TRACEWIDTH+"mm"
        }
      }
      points.forEach(function(p) { scriptLine += ` (${p.x.toFixed(6)}mm ${(exportHeight-p.y).toFixed(6)}mm)`});
      scriptLine += ";"
      out(scriptLine+"\n");
    });
  }
  if (!anyVisiblePaths)
    log("No paths with fills or strokes found.");
  container.style.display="none";
}

window.addEventListener("load", function(event) {
  container = document.getElementById("container");
  canvas = document.getElementById("can");
  ctx = canvas.getContext('2d');
  //loadSVG("test.svg");
});

// load SVG from online - not used
function loadSVG(url) {
  var xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function() {
    if (this.readyState == 4 && this.status == 200) {
       var svgs = xhr.responseXML.getElementsByTagName("svg");
       if (svgs.length) {
         var newSVG = svgs[0];
         document.getElementById("container").replaceWith(newSVG);
         container = newSVG;
         setTimeout(drawSVG,0);
       } else alert("No SVG loaded");
    }
  };
  xhr.open("GET", url, true);
  xhr.send();
}

function convert() {
//document.getElementById("fileLoader").onchange = function(event) {
  //if (event.target.files.length != 1) {
  //  alert("Select only one file");
  //  return;
  //}
  var fileToLoad = document.getElementById("fileLoader").files[0];

  var reader = new FileReader();
  reader.onload = function(event) {
    var div = document.createElement('div');
    div.innerHTML = event.target.result;
    var svgs = div.getElementsByTagName("svg");
    if (svgs.length) {
      var newSVG = svgs[0];
      container.replaceWith(newSVG);
      container = newSVG;
      setTimeout(drawSVG,0);
    } else alert("No SVG loaded");
  };
  reader.readAsText(fileToLoad);
  //reader.readAsText(event.target.files[0]);
}
