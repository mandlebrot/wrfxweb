"use strict";

/* load resources */
var fire_icon = L.icon({
  iconUrl: 'images/hot_fire.gif',
  iconSize: [15, 15],
  iconAnchor: [7, 7]
});


/*  initialize base layers & build map */
var osm_layer = L.tileLayer('http://{s}.tile.osm.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
});

var mpq_layer = L.tileLayer('http://{s}.mqcdn.com/tiles/1.0.0/map/{z}/{x}/{y}.png', {
  attribution: 'Data and imagery by MapQuest',
  subdomains: ['otile1', 'otile2', 'otile3', 'otile4']
});

var mpq_sat_layer = L.tileLayer('http://{s}.mqcdn.com/tiles/1.0.0/sat/{z}/{x}/{y}.png', {
  attribution: 'Data and imagery by MapQuest',
  subdomains: ['otile1', 'otile2', 'otile3', 'otile4']
});

var base_layer_dict = {
  'MapQuest': mpq_layer,
  'MQ Satellite': mpq_sat_layer,
  'OSM': osm_layer
};


/* construct map with the base layers */
var map = L.map('map-fd', {
  center: [39, -106],
  zoom: 7,
  layers: [mpq_layer],
  zoomControl: false
});


$.when(

  $.getJSON("simulations/catalog.json", function(data) {
    var list = $('<ul/>', {
      'class': 'catalog-list'
    }).appendTo('#catalog-content');
    $.each(data, function(cat_name) {
      var cat_entry = data[cat_name];
      var desc = cat_entry.description;
      var from = cat_entry.from_utc;
      var to = cat_entry.to_utc;
      var load_cmd = '"handle_select_click(\'simulations/' + cat_entry.manifest_path + '\');"';
      list.append('<li class="catalog-entry" onclick=' + load_cmd + '><b>' + desc + '</b><br/>' + 'from: ' + from + '<br/>to: ' + to + '</li>');
    });
  })).then(function() {

  $('ul.catalog-list > li.catalog-entry').mouseenter(function() {
    $(this).addClass('catalog-entry-sel').siblings().removeClass('catalog-entry-sel');
  });

  /* auto-opens the dialog */
  $('#select-dialog').dialog();

});


/* add scale & zoom controls to the map */
L.control.scale({
  position: 'bottomright'
}).addTo(map);

/* Map control declarations */
var layer_ctrl = null;

/* Functions that handle display logic */
var rasters = null;
var sorted_timestamps = null;
var raster_base = null;
var raster_dict = {};
var overlay_dict = {};
var all_dict = {};
var current_display = {};
var current_timestamp = null;
var preloaded = {};
var display_colorbar = null;

// the top layer of the map
var overlay_list = ['WINDVEC', 'FIRE_AREA', 'SMOKE_INT', 'FGRNHFX', 'FLINEINT'];

map.on('overlayadd', function(e) {
  current_display[e.name] = e.layer;
  if(overlay_list.indexOf(e.name) >= 0) {
    e.layer.bringToFront();
  } else {
    e.layer.bringToBack();
  }

	if(!playing || (display_colorbar == null) || (display_colorbar == e.name)) {
    var rasters_now = rasters[current_timestamp];
    if ('colorbar' in rasters_now[e.name]) {
      var cb_url = raster_base + rasters_now[e.name].colorbar;
      $('#raster-colorbar').attr('src', cb_url);
  		display_colorbar = e.name;
    }
	}

  // preload all displayed variables
  preload_variables(8);
});

map.on('overlayremove', function(e) {
  current_display[e.name] = null;
  if(!playing) {
		$('#raster-colorbar').attr('src', '');
  }
  if(display_colorbar == e.name) {
    display_colorbar = null;
  }
});

function setup_for_time(frame_ndx) {

  var timestamp = sorted_timestamps[frame_ndx];
  current_frame = frame_ndx;

  // set current time
  $('#time-valid').text(timestamp);

  // undisplay any existing raster
  var cd_memory = {};
  for (var layer_name in current_display) {
    var layer = current_display[layer_name];
    if (layer != null) {
      map.removeLayer(layer);
      cd_memory[layer_name] = null;
    }
  }

  raster_dict = {};
  overlay_dict = {};
  all_dict = {};
  $.each(rasters[timestamp], function(r) {
    var raster = rasters[timestamp][r];
    var cs = raster.coords;
    var bounds = [
      [cs[0][1], cs[0][0]],
      [cs[2][1], cs[2][0]]
    ];
    var target_dict = raster_dict;
    if (overlay_list.indexOf(r) >= 0) {
      target_dict = overlay_dict;
    }
    var layer = L.imageOverlay(raster_base + raster.raster,
      bounds, {
        attribution: 'UC Denver Wildfire Group',
        opacity: 0.5
      });
    all_dict[r] = layer;
    target_dict[r] = layer;
  });

  if (layer_ctrl != null) {
    layer_ctrl.removeFrom(map);
  }

  layer_ctrl = L.control.groupedLayers(base_layer_dict, {
    'Rasters': raster_dict,
    'Overlays': overlay_dict
  }, {
    collapsed: false
  }).addTo(map);

  for (var layer_name in cd_memory) {
    cd_memory[layer_name] = all_dict[layer_name];
    map.addLayer(cd_memory[layer_name]);
  }
  current_display = cd_memory;

  current_timestamp = timestamp;
}


function handle_select_click(path) {
  // close dialog
  $('#select-dialog').dialog("close");

  // hide all layers
  for (var layer_name in current_display) {
    map.removeLayer(current_display[layer_name]);
  }
  preloaded = {};
  current_display = {};

  $.getJSON(path, function(catalog) {
    rasters = catalog;
    var to = path.lastIndexOf('/');
    raster_base = path.substring(0, to + 1);

    // retrieve all times
    sorted_timestamps = Object.keys(rasters).sort();

    // populate jquery slider
    $('#time-slider').slider({
      min: 0,
      max: sorted_timestamps.length - 1,
      change: function(event, ui) {
        setup_for_time(ui.value);
      },
      slide: function(event, ui) {}
    });

    $('#time-slider').mousedown(function(e) {
      if(playing) toggle_play();
      e.stopPropagation();
    });

    // zoom in to the raster region
    var cs = rasters[sorted_timestamps[0]]['T2'].coords;
    var extent = [
      [cs[0][1], cs[0][0]],
      [cs[2][1], cs[2][0]]
    ];
    map.fitBounds(extent);

    // setup for time first frame
    current_frame = 0;
    playing = false;
    setup_for_time(0);
  });
}

function open_catalog() {
  $('#select-dialog').dialog("open");
}


/* Code that handles playback of frames */
var playing = false;
var current_frame = 0;

function frame_ready(frame_ndx) {
  // for all layers currently displayed
  for(var key in current_display) {
    // if the current frame is not preloaded yet
    if(!(frame_ndx in preloaded[key])) {
      console.log('Frame ' + frame_ndx + ' not ready for var ' + key);
      preload_variables(1);
      return false;
    }
    // check if the raster has a colorbar
    var cb_key = key + '_cb';
    if(cb_key in preloaded) {
      // it does, is it preloaded?
      if (!(frame_ndx in preloaded[cb_key])) {
        console.log('Frame ' + frame_ndx + ' (colorbar) not ready for var ' + key);
        preload_variables(1);
        return false;
      }
    }
  }
  console.log('Frame ' + frame_ndx + ' is ready for display.');
  return true;
}

function schedule_next_frame() {
  if(current_frame == sorted_timestamps.length-1){
    window.setTimeout(next_frame, 1000);
  } else {
    window.setTimeout(next_frame, 330);
  }
}

function next_frame() {
  if (playing) {
    current_frame = (current_frame + 1) % sorted_timestamps.length;
    if(frame_ready(current_frame)) {
      $('#time-slider').slider('value', current_frame);
      schedule_next_frame();
    } else {
      window.setTimeout(wait_for_frame, 100);
    }
  }
}

function wait_for_frame() {
  // don't do anything if playing has been cancelled
  if(!playing) {
    return
  }
  // wait until current frame is loaded
  if(frame_ready(current_frame)) {
    $('#time-slider').slider('value', current_frame);
    schedule_next_frame();
  } else {
    // keep waiting until all parts of frame are loaded
    window.setTimeout(wait_for_frame, 250);
  }
}

function toggle_play() {
  if (!playing) {
    $('#play-control-button > span').text('Pause');
    $('#play-control-button > i').attr('class', 'pause icon');
    playing = true;
    next_frame();
  } else {
    $('#play-control-button > span').text('Play');
    $('#play-control-button > i').attr('class', 'play icon');
    playing = false;
  }
}


/* Code handling auxiliary tasks */
function preload_variables(preload_count) {
  var n_rasters = Object.keys(rasters).length;
  for(var counter=0; counter < preload_count; counter++) {
    var i = (current_frame + counter) % n_rasters;
    var timestamp = sorted_timestamps[i];
    for(var var_name in current_display) {
      if(current_display[var_name] == null) {
        // skip layers that are not visible
        continue;
      }
      if(var_name in rasters[timestamp]) {
        // have we already preloaded this variable? If not indicate nothing is preloaded.
        if(!(var_name in preloaded)) {
          preloaded[var_name] = {};
        }

        if(!(i in preloaded[var_name])) {
          //console.log('Frame ' + i + ' not preloaded for ' + var_name + ' (current_frame = ' + current_frame + ')');
          var var_info = rasters[timestamp][var_name];
          var img = new Image();
          img.onload = function(ndx, var_name, img) { return function() { preloaded[var_name][ndx] = img; } } (i, var_name, img);
          img.src = raster_base + var_info.raster;
          if ('colorbar' in var_info) {
            var cb_key = var_name + '_cb';
            if(!(cb_key in preloaded)) {
              preloaded[cb_key] = {};
            }
            var cb_img = new Image();
            cb_img.onload = function(ndx, cb_key, cb_img) { return function() { preloaded[cb_key][ndx] = cb_img; } } (i, cb_key, cb_img);
            cb_img.src = raster_base + var_info.colorbar;
          }
        }
      }
    }
  }
}
