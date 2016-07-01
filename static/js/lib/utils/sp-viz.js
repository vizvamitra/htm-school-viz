$(function() {

    // Handlebars template
    var spVizTmpl;

    /* From http://stackoverflow.com/questions/7128675/from-green-to-red-color-depend-on-percentage */
    function getGreenToRed(percent){
        var r, g;
        percent = 100 - percent;
        r = percent < 50 ? 255 : Math.floor(255-(percent*2-100)*255/100);
        g = percent > 50 ? 255 : Math.floor((percent*2)*255/100);
        return rgbToHex(r, g, 0);
    }

    /* From http://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb */
    function rgbToHex(r, g, b) {
        return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    function loadTemplates(callback) {
        if (! spVizTmpl) {
            $.get('/static/tmpl/sp-viz.hbs', function(tmpl) {
                spVizTmpl = Handlebars.compile(tmpl);
                if (callback) callback();
            });
        } else {
            if (callback) callback();
        }
    }

    function loadCss() {
        $('head').append('<link rel="stylesheet" href="/static/css/lib/sp-viz.css">');
    }

    function addArrays(a, b) {
        return _.map(a, function(aval, i) {
            return aval + b[i];
        });
    }

    function getPercentDistanceCrossed(min, value, max) {
        var range = max - min;
        var adjustedValue = value - min;
        return adjustedValue / range;
    }

    function SPViz(name, el, spParams) {
        var me = this;
        this.name = name;
        this.$el = $('#' + el);
        this.heatmap = false;
        this.getConnectedSynapses = false;
        this.getPotentialPools = false;
        this.spParams = spParams;
        this.cumulativeOverlaps = [];
        _.times(this.spParams.getParams().columnDimensions[0], function() {
            me.cumulativeOverlaps.push(0);
        });
        this._createdAt = moment();
        this._iterations = 0;
        //this._initStorage();
    }

    SPViz.prototype.render = function(inputEncoding,
                                      activeColumns,
                                      overlaps,
                                      connectedSynapses,
                                      potentialPools) {
        var me = this;
        me.inputEncoding = inputEncoding;
        me.activeColumns = activeColumns;
        me.overlaps = overlaps;
        me.connectedSynapses = connectedSynapses || [];
        me.potentialPools = potentialPools || [];
        me.potentialRadius = me.spParams.getParams().potentialRadius.val;

        me.cumulativeOverlaps = addArrays(me.cumulativeOverlaps, me.overlaps);

        loadCss();
        loadTemplates(function() {
            me.$el.html(spVizTmpl());
            me.$inputEncoding = me.$el.find('#input-encoding');
            me.$activeColumns = me.$el.find('#active-columns');
            me.$overlapDisplay = me.$el.find('#overlap-display');
            me.$connections = me.$el.find('#connections');
            me._iterations++;
            me._rawRender();
            //me._save();
        });
    };

    SPViz.prototype._rawRender = function(connectedSynapses) {
        if (connectedSynapses) me.connectedSynapses = connectedSynapses;
        this._drawSdrs();
        this._addViewOptionHandlers();
        this._addSdrInteractionHandlers();
    };

    SPViz.prototype._renderHistogram = function(values,
                                                id,
                                                buckets,
                                                startX,
                                                startY,
                                                width,
                                                height) {
        // Generate a log-normal distribution with a median of 30 minutes.
        var minVal = _.min(values);
        var maxVal = _.max(values);

        // Formatters for counts and times (converting numbers to Dates).
        var formatCount = d3.format(",.0f");

        var x = d3.scale.linear()
            .domain([minVal, maxVal])
            .range([0, width]);

        // Generate a histogram using twenty uniformly-spaced bins.
        var data = d3.layout.histogram()
            .bins(x.ticks(buckets))
        (values);

        var y = d3.scale.linear()
            .domain([0, d3.max(data, function(d) { return d.y; })])
            .range([height, 0]);

        var xAxis = d3.svg.axis()
            .scale(x)
            .orient("bottom");

        var svg = d3.select('#visualization')
            .append("g")
            .attr('transform', 'translate(' + startX + ' ' + startY + ')');

        var bar = svg.selectAll(".bar")
            .data(data)
            .enter().append("g")
            .attr("class", "bar")
            .attr("transform", function(d) { return "translate(" + x(d.x) + "," + y(d.y) + ")"; });

        bar.append("rect")
            .attr("x", 1)
            .attr("style", function(d, i) {
                var overlap = d.x;
                var percent = getPercentDistanceCrossed(minVal, overlap, maxVal);
                return 'fill:#' + getGreenToRed(percent * 100) + ';';
            })
            .attr("width", width / buckets)
            .attr("height", function(d) { return height - y(d.y); });

        bar.append("text")
            .attr("dy", ".75em")
            .attr("y", 6)
            .attr("x", width / buckets / 2)
            .attr("text-anchor", "middle")
            .text(function(d) { return formatCount(d.y); });

        svg.append("g")
            .attr("class", "x axis")
            .attr("transform", "translate(0," + height + ")")
            .call(xAxis);
    };

    SPViz.prototype._renderSDR = function(sdr, id, x, y, width, height, style) {
        var bits = sdr.length;
        var root = Math.sqrt(bits);
        var rowLength = Math.floor(root);
        var hasRemainder = root % 1 > 0;
        var numRows = rowLength;
        if (hasRemainder) numRows++;
        var rectWithStrokeHeight = Math.floor(height / numRows);
        var rectWithStrokeWidth = Math.floor(width / rowLength);
        var rectHeight = rectWithStrokeHeight - 1;
        var rectWidth = rectWithStrokeWidth - 1;

        d3.select('#visualization')
            .append('g')
            .attr('id', id)
            .selectAll('rect')
            .data(sdr)
            .enter()
            .append('rect')
            .attr('width', rectWidth)
            .attr('height', rectHeight)
            .attr('x', function(d, i) {
                var offset = i % rowLength;
                return offset * rectWithStrokeWidth + x;
            })
            .attr('y', function(d, i) {
                var offset = Math.floor(i / rowLength);
                return offset * rectWithStrokeHeight + y;
            })
            .attr('index', function(d, i) { return i; })
            .attr('style', style)
        ;
    };

    SPViz.prototype._renderEncoding = function(sdr, id, x, y, width, height) {
        this._renderSDR(sdr, id, x, y, width, height,
            function(d) {
                var fill = ( d == 1 ? 'steelblue' : 'white');
                return 'fill:' + fill;
            });
    };

    SPViz.prototype._renderHeatmap = function(sdr, data, id, x, y, width, height) {
        var me = this;
        var dataMin = _.min(data);
        var dataMax = _.max(data);
        this._renderSDR(sdr, id, x, y, width, height,
            function(d, i) {
                var percent;
                var stroke = '#CACACA';
                var strokeWidth = 1;
                var fill = 'white';
                if (d == 1) {
                    fill = 'steelblue';
                }
                if (me.heatmap) {
                    percent = getPercentDistanceCrossed(dataMin, data[i], dataMax);
                    fill = '#' + getGreenToRed(percent * 100);
                    if (d == 1) {
                        stroke = 'black';
                        strokeWidth = 2;
                    }
                }
                return 'stroke:' + stroke + ';'
                    + 'fill:' + fill + ';'
                    + 'stroke-width:' + strokeWidth + ';';
            });
    };

    SPViz.prototype._drawSdrs = function() {
        var me = this;
        var inputEncoding = this.inputEncoding;
        var activeColumns = this.activeColumns;
        var overlaps = this.overlaps;

        var connectionCounts = [];

        var gutterSize = 20;
        var startX = gutterSize;
        var startY = gutterSize;

        var columnsRowLength = Math.floor(Math.sqrt(activeColumns.length));

        var width = gutterSize * 2;
        var height = gutterSize * 2;

        var encodingWidth = 300;
        var encodingHeight = 300;

        me._renderEncoding(
            inputEncoding, 'input-encoding',
            startX, startY, encodingWidth, encodingHeight
        );

        width += encodingWidth;
        startX += encodingWidth + gutterSize;

        var spWidth = 600;
        var spHeight = 600;

        me._renderHeatmap(
            activeColumns, overlaps, 'active-columns',
            startX, startY, spWidth, spHeight
        );

        width += spWidth + gutterSize;
        startY += spHeight + gutterSize;

        var overlapHistWidth = 600;
        var overlapHistHeight = 150;

        me._renderHistogram(
            overlaps, 'overlaps', columnsRowLength,
            startX, startY,
            overlapHistWidth, overlapHistHeight
        );

        width += overlapHistWidth + gutterSize;
        startX += spWidth + gutterSize;
        startY = gutterSize;

        if (me.connectedSynapses) {
            connectionCounts = _.map(me.connectedSynapses, function(d) {
                return d.length;
            });
            me._renderHeatmap(
                activeColumns, connectionCounts, 'connected-synapses',
                startX, startY, spWidth, spHeight
            );
            width += spWidth + gutterSize;
            startY += spHeight + gutterSize;

            me._renderHistogram(
                connectionCounts, 'connected-histogram', columnsRowLength,
                startX, startY,
                overlapHistWidth, overlapHistHeight
            );
        }

        height += Math.max(encodingHeight, spHeight + gutterSize + overlapHistHeight);

        d3.select('#visualization')
            .attr('width', width)
            .attr('height', height);

    };

    SPViz.prototype._addSdrInteractionHandlers = function() {
        var me = this;
        var connectedSynapses = this.connectedSynapses;
        var potentialPools = this.potentialPools;
        var $inputEncoding = this.$inputEncoding;
        var $activeColumns = this.$activeColumns;

        var highlightEncodingBits = function (evt) {
            var bitIndex = parseInt(evt.target.getAttribute('index'));
            $inputEncoding.find('rect').attr('class', '');
            if (me.getPotentialPools) {
                var pools = potentialPools[bitIndex];
                _.each(pools, function (i) {
                    $inputEncoding.find('[index="' + i + '"]').attr('class', 'pool');
                });
            }
            if (me.getConnectedSynapses) {
                var connections = connectedSynapses[bitIndex];
                _.each(connections, function (i) {
                    $inputEncoding.find('[index="' + i + '"]').attr('class', 'connected');
                });
            }
            me.$overlapDisplay.html(me.overlaps[bitIndex]);
        };
        var unhighlightEncoding = function () {
            $inputEncoding.find('rect').attr('class', '');
        };

        $activeColumns.on('mousemove', highlightEncodingBits);
        $activeColumns.on('mouseout', unhighlightEncoding);
        me.$connections.on('mousemove', highlightEncodingBits);
        me.$connections.on('mouseout', unhighlightEncoding);
    };

    SPViz.prototype._addViewOptionHandlers = function() {
        var me = this;
        this.$el.find('#heatmap').bootstrapSwitch({
            size: 'small',
            state: me.heatmap
        }).on('switchChange.bootstrapSwitch', function(event, state) {
            me.heatmap = state;
            me._drawSdrs();
        });
        this.$el.find('#connected').bootstrapSwitch({
            size: 'small',
            state: me.getConnectedSynapses
        }).on('switchChange.bootstrapSwitch', function(event, state) {
            me.getConnectedSynapses = state;
            if (me.__onViewOptionChange) {
                me.__onViewOptionChange(me.getConnectedSynapses, me.getPotentialPools);
            }
        });
        this.$el.find('#potential').bootstrapSwitch({
            size: 'small',
            state: me.getPotentialPools
        }).on('switchChange.bootstrapSwitch', function(event, state) {
            me.getPotentialPools = state;
            if (me.__onViewOptionChange) {
                me.__onViewOptionChange(me.getConnectedSynapses, me.getPotentialPools);
            }
        });
    };

    SPViz.prototype.onViewOptionChange = function(func) {
        this.__onViewOptionChange = func;
    };

    SPViz.prototype._getStorageId = function() {
        return this.name + ' | ' + this._createdAt.format();
    };


    SPViz.prototype._initStorage = function() {
        var id = this._getStorageId();
        var batches = localStorage.getItem('batches');
        if (! batches) {
            batches = [];
        } else {
            batches = JSON.parse(batches);
        }
        batches.push({
            id: id,
            name: this.name,
            created: this._createdAt.format(),
            iterations: 0
        });
        this._batches = batches;
        localStorage.setItem('batches', JSON.stringify(batches));
    };

    SPViz.prototype._save = function() {
        var id = this._getStorageId();
        var payload = {
            overlaps: this.overlaps
        };
        var batch = _.find(this._batches, function(b) {
            return b.id == id;
        });
        localStorage[id + ':' + batch.iterations++] = JSON.stringify(payload);
        localStorage.batches = JSON.stringify(this._batches);
    };

    window.HTM.utils.sp.SPViz = SPViz;

});